import type { AiLesson } from "@/lib/ai-courses";
import styles from "./studio.module.css";

type ReviewQuestion = { type: string; prompt: string; options: string[]; correctOptionIndex: number | null; answer: string | null; explanation: string | null; reference?: string | null };
function Questions({ questions }: { questions: ReviewQuestion[] }) {
  return <ol>{questions.map((question, index) => <li key={index}><strong>{question.prompt}</strong>
    {question.options.length > 0 && <ul>{question.options.map((option, j) => <li key={j}>{String.fromCharCode(65 + j)}. {option}</li>)}</ul>}
    <p>Đáp án: <b>{question.type === "multiple_choice" ? question.options[question.correctOptionIndex ?? -1] : question.answer}</b><br />{question.explanation}</p>
    {question.reference && <blockquote>{question.reference}</blockquote>}
  </li>)}</ol>;
}
export default function AiLessonPreview({ lesson }: { lesson: AiLesson }) {
  return <>
    {lesson.listening && <details><summary>Xem script &amp; đáp án ({lesson.listening.questions.length} câu)</summary><p className={styles.transcript}>{lesson.listening.transcript}</p><Questions questions={lesson.listening.questions} /></details>}
    {lesson.speaking && <details><summary>Xem mục tiêu &amp; câu luyện nói ({lesson.speaking.sentences.length} câu)</summary><p>{lesson.speaking.goals}</p><ol>{lesson.speaking.sentences.map((sentence, index) => <li key={index}><p lang="en">{sentence.text}</p>{sentence.ipa && <small>{sentence.ipa}</small>}</li>)}</ol></details>}
    {lesson.reading && <details><summary>Xem bài đọc, từ vựng &amp; đáp án ({lesson.reading.questions.length} câu)</summary><h4>{lesson.reading.passageTitle}</h4><p>{lesson.reading.instructions}</p><p className={styles.transcript} lang="en">{lesson.reading.passage}</p><h4>Bản dịch</h4><p className={styles.transcript}>{lesson.reading.translation}</p><h4>Từ vựng</h4><ul>{lesson.reading.vocabulary.map((item, index) => <li key={index}><b>{item.word}</b>: {item.meaning}<p lang="en">{item.example}</p></li>)}</ul><Questions questions={lesson.reading.questions} /></details>}
    {lesson.grammar && <details><summary>Xem lý thuyết &amp; bài tập ({lesson.grammar.questions.length} câu)</summary><h4>{lesson.grammar.topic}</h4><p className={styles.transcript}>{lesson.grammar.rules}</p><h4>Lỗi thường gặp</h4><p className={styles.transcript}>{lesson.grammar.commonMistakes}</p><Questions questions={lesson.grammar.questions} /></details>}
    {lesson.writing && <details><summary>Xem đề viết, tiêu chí &amp; bài mẫu</summary><p>{lesson.writing.taskType} · {lesson.writing.minWords}–{lesson.writing.maxWords} từ</p><p className={styles.transcript} lang="en">{lesson.writing.prompt}</p><p>{lesson.writing.instructions}</p><ul>{lesson.writing.rubric.map((item, index) => <li key={index}><b>{item.name} ({item.weight}%)</b>: {item.description}</li>)}</ul><h4>Bài viết tham khảo</h4><p className={styles.transcript} lang="en">{lesson.writing.sampleAnswer}</p></details>}
  </>;
}
