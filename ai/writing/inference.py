"""Long-lived local adapters for the API. No database, uploads, or silent truncation."""
from __future__ import annotations

import json
import hashlib
import os
import re
import threading
from pathlib import Path

from data import ROOT, LEVELS
from gec_safety import GUARD_VERSION, body_sentence_spans, correction_rejection_reason
from writing_explanations import TEMPLATE_VERSION, explain_accepted_change
from cefr_input import POLICY_VERSION, assess_input, assessment_message

os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("DISABLE_SAFETENSORS_CONVERSION", "true")
os.environ.setdefault("HF_HUB_OFFLINE", "1")


class InputBudgetError(ValueError):
    pass


class IncompleteGenerationError(InputBudgetError):
    """Generation ran but did not produce a complete, nonempty correction."""


class EngineBusyError(RuntimeError):
    pass


class Adapter:
    def __init__(self, directory: Path, task: str, device: str, *, allow_experiment: bool = False):
        from training_state import validate_loadable_run
        self.manifest = validate_loadable_run(directory, task, allow_experiment=allow_experiment)
        import torch
        from peft import PeftModel
        from transformers import AutoTokenizer
        from modeling import load_base
        self.run_name = directory.name
        with (directory / "best" / "adapter_model.safetensors").open("rb") as stream:
            self.adapter_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
        self.device = device
        self.dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
        self.tokenizer = AutoTokenizer.from_pretrained(directory / "best", use_fast=False)
        self.model = PeftModel.from_pretrained(load_base(self.manifest["model_id"], task, self.dtype,
                                                       revision=self.manifest.get("base_revision")), directory / "best")
        self.model.to(device).eval()
        self.model.config.use_cache = True

    def inputs(self, text, prompt=None):
        if self.manifest.get("cefr_input_mode", "essay") == "prompt-essay":
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("This experimental CEFR adapter requires its prompt text")
            inputs = self.tokenizer(prompt, text, return_tensors="pt", truncation=False)
        else:
            inputs = self.tokenizer(text, return_tensors="pt", truncation=False)
        if inputs["input_ids"].shape[1] > self.manifest["max_input_length"]:
            raise InputBudgetError("Bài viết vượt giới hạn của mô hình. Hãy chia thành các bài ngắn hơn.")
        return inputs.to(self.device)

    def classify(self, text, prompt=None):
        import torch
        inputs = self.inputs(text, prompt)
        with torch.inference_mode(), torch.autocast(self.device, dtype=torch.bfloat16,
                                                   enabled=self.dtype == torch.bfloat16):
            probabilities = self.model(**inputs).logits[0].float().softmax(-1).cpu().tolist()
        return LEVELS[max(range(len(LEVELS)), key=probabilities.__getitem__)]

    def correct(self, text):
        import torch
        inputs = self.inputs(text)
        with torch.inference_mode(), torch.autocast(self.device, dtype=torch.bfloat16,
                                                   enabled=self.dtype == torch.bfloat16):
            ids = self.model.generate(**inputs, do_sample=False,
                                      max_new_tokens=self.manifest["max_target_length"])
        if self.tokenizer.eos_token_id not in ids[0].tolist():
            raise IncompleteGenerationError("Mô hình chưa tạo xong bản sửa trong giới hạn cho phép.")
        return self.tokenizer.decode(ids[0], skip_special_tokens=True).strip()


class WritingEngine:
    def __init__(self, cefr_run: Path, gec_run: Path | None = None, device: str = "auto"):
        import torch
        import spacy
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device not in ("cpu", "cuda"):
            raise ValueError("WRITING_DEVICE must be auto, cpu, or cuda")
        self.cefr = Adapter(cefr_run, "cefr", device)
        self.gec = Adapter(gec_run, "gec", device) if gec_run else None
        self.nlp = spacy.blank("en")
        self.nlp.add_pipe("sentencizer")
        self.lock = threading.Lock()

    def processing_limits(self):
        return {"cefrLimit": self.cefr.manifest["max_input_length"],
                "gecInputLimit": self.gec.manifest["max_input_length"] if self.gec else None,
                "gecSentenceLimit": 20, "correctionsEnabled": self.gec is not None}

    def preflight(self, text: str, corrections: bool = False):
        """Tokenize only: do not generate, classify, acquire GPU tensors, or save text."""
        limits = self.processing_limits()
        cefr_tokens = len(self.cefr.tokenizer(text, truncation=False)["input_ids"])
        sentences = []
        if corrections and self.gec is not None:
            for index, (start, end) in enumerate(body_sentence_spans(text, self.nlp)):
                tokens = len(self.gec.tokenizer(text[start:end].strip(), truncation=False)["input_ids"])
                status = ("sentenceLimit" if index >= limits["gecSentenceLimit"] else
                          "inputOverBudget" if tokens > limits["gecInputLimit"] else "ready")
                sentences.append({"index": index, "start": utf16_offset(text, start),
                                  "end": utf16_offset(text, end), "tokens": tokens, "status": status})
        return {**limits, "cefrTokens": cefr_tokens,
                "canAnalyze": cefr_tokens <= limits["cefrLimit"], "sentences": sentences,
                "inputAssessment": assess_input(text)}

    def analyze(self, text: str, corrections: bool = False):
        assessment=assess_input(text)
        if assessment['status']=='insufficient':
            raise InputBudgetError(assessment_message(assessment))
        if not self.lock.acquire(blocking=False):
            raise EngineBusyError("AI đang xử lý bài khác. Vui lòng thử lại sau.")
        try:
            level = self.cefr.classify(text)  # Always score the learner's original text.
            warnings = ["CEFR là ước lượng thử nghiệm; A1 và C2 chưa được nhận diện đáng tin cậy.",
                        "Kết quả chưa đánh giá độ bám đề và không phải điểm IELTS hoặc điểm 0–10."]
            warnings.extend(assessment['warnings'])
            errors = []
            corrected = None
            coverage = None
            if corrections and self.gec is None:
                warnings.append("Phần sửa ngữ pháp chưa được bật. Bài viết vẫn được chấm CEFR.")
            elif corrections:
                warnings.append("Bản sửa là gợi ý thử nghiệm. Hãy kiểm tra lại ý nghĩa trước khi sử dụng.")
                pieces, cursor = [], 0
                spans = list(body_sentence_spans(text, self.nlp))
                coverage = {"totalBodySentences": len(spans), "changed": 0, "unchanged": 0,
                            "rejected": 0, "inputOverBudget": 0, "incomplete": 0, "sentenceLimit": 0}
                for index, (start, end) in enumerate(spans):
                    original = text[start:end]
                    pieces.append(text[cursor:start])
                    if index >= 20:
                        coverage["sentenceLimit"] += 1
                        pieces.append(original)
                        warnings.append("Có câu ngoài giới hạn 20 câu chưa được xử lý; câu gốc được giữ nguyên.")
                        cursor = end
                        continue
                    try:
                        # Train pairs contain raw English; keep punctuation and contractions attached.
                        proposed = self.gec.correct(original.strip())
                        core = proposed.strip()
                        # spaCy keeps leading paragraph whitespace inside sentence spans.
                        core = re.sub(
                            r"\b(do|does|did|is|are|was|were|has|have|had|ca|could|wo|would|should|must|need|dare|sha|ai|might|may)\s*n\s*(['’])\s*t\b",
                            r"\1n\2t", core, flags=re.IGNORECASE)
                        if not core:
                            raise IncompleteGenerationError("Mô hình trả về bản sửa rỗng.")
                        if correction_rejection_reason(original.strip(), core):
                            coverage["rejected"] += 1
                            pieces.append(original)
                            warnings.append("Có gợi ý sửa bị chặn vì thay đổi nội dung hoặc cấu trúc đáng ngờ; câu gốc được giữ nguyên. Đây không phải kiểm chứng đầy đủ về ý nghĩa.")
                            cursor = end
                            continue
                        leading = original[:len(original) - len(original.lstrip())]
                        trailing = original[len(original.rstrip()):]
                        replacement = leading + core + trailing
                        if original.strip() == core:
                            replacement = original
                        if replacement != original:
                            coverage["changed"] += 1
                            errors.append({"original": original, "suggestion": replacement,
                                           "explanations": explain_accepted_change(original, replacement),
                                           "sourceStart": utf16_offset(text, start),
                                           "sourceEnd": utf16_offset(text, end)})
                        else:
                            coverage["unchanged"] += 1
                        pieces.append(replacement)
                    except IncompleteGenerationError:
                        coverage["incomplete"] += 1
                        pieces.append(original)
                        warnings.append("Có câu chưa sinh bản sửa hoàn tất; câu gốc được giữ nguyên.")
                    except InputBudgetError:
                        coverage["inputOverBudget"] += 1
                        pieces.append(original)
                        warnings.append("Có câu vượt ngân sách token đầu vào; câu gốc được giữ nguyên.")
                    cursor = end
                pieces.append(text[cursor:])
                corrected = "".join(pieces)
                if not errors:
                    warnings.append("Chưa có gợi ý thay đổi không có nghĩa là bài viết không còn lỗi.")
            return {"cefr": level, "correctedText": corrected, "errors": errors,
                    "gecCoverage": coverage,
                    "warnings": list(dict.fromkeys(warnings)),
                    "provenance": {"cefrRun": getattr(self.cefr, "run_name", None),
                        "cefrAdapterSha256": getattr(self.cefr, "adapter_sha256", None),
                        "gecRun": getattr(self.gec, "run_name", None),
                        "gecAdapterSha256": getattr(self.gec, "adapter_sha256", None),
                        "explanationVersion": TEMPLATE_VERSION,
                        "guardVersion": GUARD_VERSION if coverage is not None else None,
                        "inputPolicyVersion": POLICY_VERSION}}
        finally:
            self.lock.release()


def utf16_offset(text: str, position: int) -> int:
    """Browser/.NET offsets; astral characters occupy two UTF-16 code units."""
    return len(text[:position].encode("utf-16-le", errors="surrogatepass")) // 2
