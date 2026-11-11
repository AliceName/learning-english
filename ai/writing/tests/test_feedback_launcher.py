"""Launcher gate integration tests use a fake executable, never an AI worker."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CSC = Path(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe")
from synthetic_feedback_fixture import write_feedback_fixture


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipUnless(os.name == "nt" and CSC.exists() and shutil.which("powershell.exe"), "Windows PowerShell/.NET compiler required")
class FeedbackLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix="feedback fake compiler ")
        source = Path(cls.build.name) / "FakePython.cs"
        cls.fake = Path(cls.build.name) / "python.exe"
        source.write_text(r'''
using System;
using System.IO;
class FakePython {
  static int Main(string[] args) {
    File.WriteAllLines(Environment.GetEnvironmentVariable("FEEDBACK_CAPTURE"), new string[] {
      Environment.GetEnvironmentVariable("WRITING_FEEDBACK_ENABLED"),
      Environment.GetEnvironmentVariable("WRITING_FEEDBACK_MANIFEST"),
      Environment.GetEnvironmentVariable("WRITING_CEFR_RUN"),
      Environment.GetEnvironmentVariable("WRITING_GEC_RUN"),
      String.Join("|", args)
    });
    if (Environment.GetEnvironmentVariable("FEEDBACK_FAKE_STDERR") == "1") {
      Console.Error.WriteLine("INFO: synthetic server is ready");
    }
    string exitCode = Environment.GetEnvironmentVariable("FEEDBACK_FAKE_EXIT");
    return String.IsNullOrEmpty(exitCode) ? 0 : Int32.Parse(exitCode);
  }
}
''', encoding="utf-8")
        result = subprocess.run([str(CSC), "/nologo", "/target:exe", "/out:" + str(cls.fake), str(source)], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="Feedback launch workspace ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(ROOT / "Start-Writing.ps1", self.root / "Start-Writing.ps1")
        for name in ("local_feedback.py", "benchmark_feedback.py"):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        write_feedback_fixture(self.root / "examples/feedback-benchmark.jsonl")
        executable = self.root / ".venv/Scripts/python.exe"
        executable.parent.mkdir(parents=True)
        shutil.copyfile(self.fake, executable)
        self.capture = self.root / "launched.txt"
        self.runtime = self.root / "payload/runtime"
        self.runtime.mkdir(parents=True)
        server = self.runtime / "llama-server.exe"
        server.write_bytes(b"not an executable, never launched")
        self.model = self.root / "payload/model.gguf"
        self.model.write_bytes(b"synthetic payload")
        self.manifest = self.root / "payload/manifest.json"
        self.manifest_data = {"modelId": "Qwen/Qwen2.5-1.5B-Instruct-GGUF", "modelPath": str(self.model),
                              "modelSha256": sha(self.model), "runtimePath": str(server), "runtimeSha256": sha(server),
                              "runtimeFiles": {"llama-server.exe": sha(server)}}
        self.manifest.write_text(json.dumps(self.manifest_data), encoding="utf-8")
        self.benchmark = self.root / "passed benchmark.json"
        self.report = {"kind": "self_authored_local_feedback_operational_benchmark_not_semantic_acceptance",
                       "technical_gate_passed": True, "cases": 30, "readyCount": 27, "maxSeconds": 30,
                       "p95Seconds": 28, "coldStartupSeconds": 3, "allMeasuredRequestsStartedWarm": True,
                       "successfuldoesnotmeanpedagogyvalidated": True, "modelId": self.manifest_data["modelId"],
                       "modelSha256": sha(self.model), "manifestSha256": sha(self.manifest),
                       "feedbackSourceSha256": sha(self.root / "local_feedback.py"),
                       "fixtureSha256": sha(self.root / "examples/feedback-benchmark.jsonl"),
                       "benchmarkSourceSha256": sha(self.root / "benchmark_feedback.py")}
        self.save_report(self.report)

    def save_report(self, value):
        self.benchmark.write_text(json.dumps(value), encoding="utf-8")

    def run_launcher(self, *arguments, env_extra=None, redirect=False):
        environment = dict(os.environ, FEEDBACK_CAPTURE=str(self.capture), WRITING_FEEDBACK_ENABLED="1",
                           WRITING_FEEDBACK_MANIFEST="stale inherited value")
        environment.update(env_extra or {})
        if redirect:
            wrapper = self.root / "redirect-launch.ps1"
            wrapper.write_text("$ErrorActionPreference = 'Stop'\n"
                               "& (Join-Path $PSScriptRoot 'Start-Writing.ps1') *> (Join-Path $PSScriptRoot 'server.log')\n"
                               "'outer caller continued' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'continued.txt')\n", encoding="utf-8")
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(wrapper)]
        else:
            command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                       str(self.root / "Start-Writing.ps1"), *arguments]
        return subprocess.run(command,
                              capture_output=True, text=True, errors="replace", env=environment, timeout=20)

    def enable(self):
        return self.run_launcher("-EnableFeedback", "-FeedbackManifest", str(self.manifest),
                                 "-FeedbackBenchmark", str(self.benchmark))

    def assert_rejected(self, report):
        self.capture.unlink(missing_ok=True)
        self.save_report(report)
        result = self.enable()
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(self.capture.exists(), result.stdout + result.stderr)

    def test_default_explicitly_disables_inherited_feedback_and_keeps_model_arguments(self):
        result = self.run_launcher("-CefrRun", "artifacts/cefr-original", "-GecRun", "artifacts/gec-original")
        self.assertEqual(0, result.returncode, result.stderr)
        lines = self.capture.read_text(encoding="utf-8-sig").splitlines()
        self.assertEqual(["0", ""], lines[:2])
        self.assertTrue(lines[2].endswith("cefr-original"))
        self.assertTrue(lines[3].endswith("gec-original"))
        self.assertIn("--host|127.0.0.1", lines[4])

    def test_enable_requires_benchmark_before_python(self):
        result = self.run_launcher("-EnableFeedback")
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(self.capture.exists())
        result = self.run_launcher("-EnableFeedback", "-FeedbackManifest", str(self.manifest),
                                   "-FeedbackBenchmark", str(self.root / "missing benchmark.json"))
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(self.capture.exists())

    def test_redirected_native_info_stderr_does_not_stop_healthy_server(self):
        result = self.run_launcher(env_extra={"FEEDBACK_FAKE_STDERR": "1"}, redirect=True)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertTrue(self.capture.exists())
        self.assertTrue((self.root / "continued.txt").exists())
        self.assertIn("synthetic server is ready", (self.root / "server.log").read_text(encoding="utf-16"))

    def test_nonzero_native_exit_fails_even_with_redirected_info_stderr(self):
        result = self.run_launcher(env_extra={"FEEDBACK_FAKE_STDERR": "1", "FEEDBACK_FAKE_EXIT": "7"}, redirect=True)
        self.assertNotEqual(0, result.returncode)
        self.assertTrue(self.capture.exists())
        self.assertFalse((self.root / "continued.txt").exists())
        self.assertIn("Writing AI exited with code 7", result.stderr + (self.root / "server.log").read_text(encoding="utf-16"))

    def test_valid_boundary_report_enables_only_after_pin_checks(self):
        result = self.enable()
        self.assertEqual(0, result.returncode, result.stderr)
        lines = self.capture.read_text(encoding="utf-8-sig").splitlines()
        self.assertEqual("1", lines[0])
        self.assertEqual(str(self.manifest), lines[1])

    def test_failed_incomplete_or_non_warm_report_never_launches(self):
        for key, value in (("technical_gate_passed", False), ("technical_gate_passed", "true"),
                           ("cases", 29), ("cases", "30"), ("readyCount", 26), ("readyCount", 31),
                           ("allMeasuredRequestsStartedWarm", False), ("successfuldoesnotmeanpedagogyvalidated", False)):
            with self.subTest(key=key, value=value):
                self.assert_rejected(dict(self.report, **{key: value}))

    def test_missing_negative_or_string_measurements_never_launch(self):
        for key in ("maxSeconds", "p95Seconds", "coldStartupSeconds"):
            for value in (None, -1, "1"):
                with self.subTest(key=key, value=value):
                    self.assert_rejected(dict(self.report, **{key: value}))
            missing = copy.deepcopy(self.report)
            del missing[key]
            self.assert_rejected(missing)
        self.assert_rejected(dict(self.report, maxSeconds=30.00001))
        self.assert_rejected(dict(self.report, p95Seconds=31))

    def test_stale_model_manifest_code_fixture_or_benchmark_source_never_launches(self):
        for key in ("modelSha256", "manifestSha256", "feedbackSourceSha256", "fixtureSha256", "benchmarkSourceSha256"):
            with self.subTest(key=key):
                self.assert_rejected(dict(self.report, **{key: "0" * 64}))

    def test_changed_payload_and_escaping_runtime_member_never_launch(self):
        self.model.write_bytes(b"changed model")
        self.assert_rejected(self.report)
        self.model.write_bytes(b"synthetic payload")
        changed = dict(self.manifest_data, runtimeFiles={"../model.gguf": sha(self.model)})
        self.manifest.write_text(json.dumps(changed), encoding="utf-8")
        self.assert_rejected(dict(self.report, manifestSha256=sha(self.manifest)))

    def test_changed_server_or_runtime_library_never_launches(self):
        server = self.runtime / "llama-server.exe"
        server.write_bytes(b"changed native worker")
        self.assert_rejected(self.report)
        server.write_bytes(b"not an executable, never launched")
        library = self.runtime / "ggml-cpu.dll"
        library.write_bytes(b"expected dependency")
        changed = copy.deepcopy(self.manifest_data)
        changed["runtimeFiles"][library.name] = sha(library)
        self.manifest.write_text(json.dumps(changed), encoding="utf-8")
        report = dict(self.report, manifestSha256=sha(self.manifest))
        library.write_bytes(b"modified dependency")
        self.assert_rejected(report)


if __name__ == "__main__":
    unittest.main()
