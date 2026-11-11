import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from modeling import encode_row, load_cefr_prompts, cefr_input_spec, check_cefr_input_continuation
from tokenization_cache import encode_cached, json_hash
from training_state import check_resume


class Tokens:
    def __call__(self, first, second=None, truncation=False):
        assert truncation is False
        ids = [101]+[ord(c) for c in first]+[102]
        if second is not None:
            ids += [ord(c) for c in second]+[102]
        return dict(input_ids=ids, attention_mask=[1]*len(ids))


class PromptInputTests(unittest.TestCase):
    def test_default_is_byte_for_byte_old_input_and_pair_has_both_segments(self):
        row = dict(text="Essay", cefr="B1", prompt_id="p", prompt_level="Advanced")
        old = encode_row(row, 'cefr', Tokens(), 512, 384)
        self.assertEqual(old, {**Tokens()(row['text']), 'labels': 2})
        pair = encode_row(row, 'cefr', Tokens(), 512, 384, 'prompt-essay', {'p':'Task'})
        self.assertEqual(pair, {**Tokens()('Task','Essay'), 'labels': 2})
        self.assertNotIn('prompt_level', pair)

    def test_missing_prompt_and_non_cefr_modes_rejected(self):
        row = dict(text="Essay",cefr="B1",prompt_id="unknown")
        for task, mode, prompts in [('cefr','prompt-essay',{}),('gec','prompt-essay',{'unknown':'Task'}),('cefr','other',{})]:
            with self.assertRaises(ValueError):
                encode_row(row,task,Tokens(),512,384,mode,prompts)

    def test_whole_pair_budget_no_truncation(self):
        row = dict(text="Essay",cefr="B1",prompt_id="p")
        self.assertIsNotNone(encode_row(row,'cefr',Tokens(),10,384))
        self.assertIsNone(encode_row(row,'cefr',Tokens(),10,384,'prompt-essay',{'p':'Long prompt'}))

    def test_catalog_duplicate_empty_and_hash_change(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'prompts.tsv'
            path.write_text('public_prompt_id\tprompt\tprompt_level\np\tTask\tAdvanced\n',encoding='utf-8')
            self.assertEqual(load_cefr_prompts(path),{'p':'Task'})
            spec=cefr_input_spec('prompt-essay',path)
            path.write_text('public_prompt_id\tprompt\np\tDifferent\n',encoding='utf-8')
            self.assertNotEqual(spec,cefr_input_spec('prompt-essay',path))
            for payload in ('public_prompt_id\tprompt\np\tTask\np\tTask2\n','public_prompt_id\tprompt\np\t \n','public_prompt_id\tprompt\n'):
                path.write_text(payload,encoding='utf-8')
                with self.assertRaises(ValueError):load_cefr_prompts(path)
            with self.assertRaises(ValueError):cefr_input_spec('prompt-essay')

    def test_continuation_rejects_mode_catalog_and_format_changes(self):
        pair=dict(cefr_input_mode='prompt-essay',cefr_input_format='tokenizer-pair-v1',cefr_prompt_catalog_sha256='a')
        check_cefr_input_continuation(pair,dict(pair))
        check_cefr_input_continuation({},cefr_input_spec())
        for field,value in [('cefr_input_mode','essay'),('cefr_input_format','changed'),('cefr_prompt_catalog_sha256','b')]:
            with self.assertRaises(ValueError):check_cefr_input_continuation(pair,{**pair,field:value})
        with self.assertRaises(ValueError):check_cefr_input_continuation({},pair)
        with self.assertRaises(ValueError):check_cefr_input_continuation({'cefr_input_mode':'prompt-essay'},pair)

    def test_cache_never_reuses_other_input_mode_or_catalog(self):
        base=dict(task='cefr',max_input_length=512,**cefr_input_spec())
        rows=[dict(input_ids=[1,2],attention_mask=[1,1],labels=2)]
        stats=dict(selected=1,encoded=1,over_length_skipped=0,labels={'B1':1})
        with tempfile.TemporaryDirectory() as directory:
            build=lambda:(rows,stats)
            self.assertEqual(encode_cached(Path(directory),base,build)[2]['status'],'miss')
            self.assertEqual(encode_cached(Path(directory),base,build)[2]['status'],'hit')
            pair={**base,'cefr_input_mode':'prompt-essay','cefr_input_format':'tokenizer-pair-v1','cefr_prompt_catalog_sha256':'a'}
            self.assertNotEqual(json_hash(base),json_hash(pair))
            self.assertEqual(encode_cached(Path(directory),pair,build)[2]['status'],'miss')
            self.assertEqual(encode_cached(Path(directory),{**pair,'cefr_prompt_catalog_sha256':'b'},build)[2]['status'],'miss')

    def test_actual_resume_rejects_legacy_mode_switch_before_optimizer_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'run.json').write_text(json.dumps(dict(task='cefr',completed=False)),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'input mode'):
                check_resume(root/'checkpoint-1',root,dict(task='cefr',**{'cefr_input_mode':'prompt-essay','cefr_input_format':'tokenizer-pair-v1','cefr_prompt_catalog_sha256':'a'}))

    def test_inference_requires_prompt_for_experimental_pair_adapter(self):
        from inference import Adapter
        adapter=Adapter.__new__(Adapter)
        adapter.manifest={'cefr_input_mode':'prompt-essay'}
        with self.assertRaisesRegex(ValueError,'requires its prompt'):
            adapter.inputs('Essay')


if __name__=='__main__':unittest.main()
