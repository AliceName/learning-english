import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cefr_input import assess_input
from inference import WritingEngine,InputBudgetError

class InputTests(unittest.TestCase):
    def test_short_is_distinct_from_warning(self):
        self.assertEqual(assess_input('Hi, nice day!')['reasons'],['tooShort'])
        result=assess_input('I like my new school very much.')
        self.assertEqual(result['status'],'eligible');self.assertTrue(result['warnings'])
        self.assertEqual(assess_input('I am 21 years old.')['status'],'eligible')
        self.assertEqual(assess_input('123 456 789 012 345')['status'],'insufficient')
    def test_repeated_sentence_or_unpunctuated_loop_is_insufficient(self):
        for text in [('Epistemological complexity facilitates sophisticated interpersonal interpretation. '*10),
                     ('I like my new school '*6)]:
            self.assertIn('repetition',assess_input(text)['reasons'])
    def test_regular_repetition_and_varied_simple_english_are_allowed(self):
        for text in ['I read books. I play football. I like my school. My teacher helps me learn.',
                     'I think we can improve. I think we should listen. I think change takes time.',
                     'Dear Mai, I enjoyed visiting Hà Nội with you last summer. Thank you for your help.']:
            self.assertEqual(assess_input(text)['status'],'eligible',text)
    def test_non_latin_is_conservative_not_general_language_identification(self):
        self.assertIn('unsupportedScript',assess_input('这是一个关于我的学校的故事。我喜欢学习新的知识。')['reasons'])
        self.assertNotIn('unsupportedScript',assess_input('Je voudrais raconter mon voyage pendant les vacances.')['reasons'])
    def test_unsupported_input_never_invokes_model(self):
        value=WritingEngine.__new__(WritingEngine)
        def fail(*args):raise AssertionError('Must not classify')
        value.cefr=SimpleNamespace(classify=fail);value.lock=threading.Lock()
        with self.assertRaises(InputBudgetError):value.analyze('Hello')
        self.assertFalse(value.lock.locked())
    def test_http_rejects_invalid_input_without_a_band(self):
        from fastapi.testclient import TestClient
        from serve import create_app
        value=WritingEngine.__new__(WritingEngine)
        value.gec=None
        with TestClient(create_app(lambda:value)) as client:
            for text in ['Hi', 'Epistemological complexity facilitates sophisticated interpersonal interpretation. '*10]:
                response=client.post('/internal/writing/analyze',json={'text':text,'corrections':False})
                self.assertEqual(response.status_code,422)
                self.assertIn('detail',response.json());self.assertNotIn('cefr',response.json())

if __name__=='__main__':unittest.main()
