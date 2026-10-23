export const authoringSkills = ["speaking", "listening", "reading", "writing", "grammar"] as const;
export type Skill = typeof authoringSkills[number];
export const lessonKinds = {
  speaking: {label:"Speaking", icon:"mic", placeholder:"Unit 1: Daily Communication"},
  listening: {label:"Listening", icon:"headphones", placeholder:"Unit 2: Office Meetings"},
  grammar: {label:"Grammar", icon:"book", placeholder:"Unit 3: Present Perfect & Past Simple"},
  writing: {label:"Writing", icon:"writing", placeholder:"Unit 4: Write a formal email"},
  reading: {label:"Reading", icon:"file", placeholder:"Unit 3: The future of urban transport"},
} as const;
export function isAuthoringSkill(value: string): value is Skill { return authoringSkills.includes(value as Skill); }
export type Sentence = { text: string; ipa: string | null; audioUrl: string | null };
export type GeneratedIpa = { ipa: string | null; accent: "en-US"; unknownWords: string[]; alternatives: {word:string;pronunciations:string[]}[] };
export type Question = { type: "multiple_choice" | "fill_blank" | "matching"; prompt: string; options: string[]; correctOptionIndex: number | null; answer: string | null; caseSensitive: boolean; explanation: string | null; atSeconds: number | null; pairs: {left: string; right: string}[] };
export type Speaking = { goals: string; sentences: Sentence[] };
export type Listening = { transcript: string; hideTranscriptFirstListen: boolean; questions: Question[] };
export type GrammarQuestion = {
  type:"multiple_choice"|"fill_blank"|"error_correction"; prompt:string; options:string[]; correctOptionIndex:number|null;
  answer:string|null; acceptedAnswers:string[]; caseSensitive:boolean; correction:string|null; tag:string|null; explanation:string|null;
};
export type Grammar = {topic:string;rules:string;commonMistakes:string;questions:GrammarQuestion[]};
export const writingTaskTypes={essay:"Bài luận",email:"Email / thư",paragraph:"Đoạn văn",report:"Báo cáo",proposal:"Đề xuất / Proposal"} as const;
export type WritingCriterion={name:string;description:string;weight:number};
export type Writing={taskType:keyof typeof writingTaskTypes;topic:string;prompt:string;instructions:string;minWords:number;maxWords:number;sampleAnswer:string;rubric:WritingCriterion[]};
export const readingQuestionTypes={multiple_choice:"Trắc nghiệm",fill_blank:"Điền từ",short_answer:"Trả lời ngắn",true_false_not_given:"True / False / Not Given",matching:"Nối ý / tiêu đề"} as const;
export const readingFocus={skimming:"Skimming · Đọc lướt",scanning:"Scanning · Tìm chi tiết",inference:"Inference · Suy luận",vocabulary:"Vocabulary · Từ vựng"} as const;
export type ReadingQuestion={type:keyof typeof readingQuestionTypes;prompt:string;options:string[];correctOptionIndex:number|null;answer:string|null;acceptedAnswers:string[];caseSensitive:boolean;explanation:string|null;reference:string|null;focus:keyof typeof readingFocus;points:number;pairs:{left:string;right:string}[]};
export type Reading={passageTitle:string;category:string;passage:string;translation:string;instructions:string;vocabulary:{word:string;meaning:string;example:string}[];questions:ReadingQuestion[]};
export type LessonDraft = { title: string; skillType: Skill; difficultyLevel: string; estimatedMinutes: number; isActive: boolean; audioUrl: string | null; speaking: Speaking | null; listening: Listening | null; grammar:Grammar|null;writing:Writing|null;reading:Reading|null };
export type AdminLesson = Omit<LessonDraft, "skillType"> & { lessonId: number; orderIndex: number; skillType: string; contentSupported: boolean };
export type AdminCourse = { courseId: number; title: string; description: string | null; coverImageUrl: string | null; isPublished: boolean; updatedAt: string; lessons: AdminLesson[] };
export type AdminCourseList = { items: {courseId: number; title: string; coverImageUrl: string | null; isPublished: boolean; lessonCount: number; updatedAt: string}[]; totalCount: number; page: number; pageSize: number; totalPages: number };
export function blankLesson(skill: Skill, level = "B1", minutes = 20): LessonDraft {
  return { title: "", skillType: skill, difficultyLevel: level, estimatedMinutes: minutes, isActive: true, audioUrl: null,
    speaking: skill === "speaking" ? { goals: "", sentences: [] } : null,
    listening: skill === "listening" ? { transcript: "", hideTranscriptFirstListen: true, questions: [] } : null,
    grammar:skill === "grammar" ? {topic:"",rules:"",commonMistakes:"",questions:[]} : null,
    writing:skill === "writing" ? blankWriting() : null,
    reading:skill === "reading" ? blankReading() : null };
}
export function lessonDraft(lesson: AdminLesson, skill: Skill): LessonDraft {
  return { ...blankLesson(skill), title: lesson.title, skillType: skill, difficultyLevel: lesson.difficultyLevel ?? "B1",
    estimatedMinutes: lesson.estimatedMinutes ?? 20, isActive: lesson.isActive, audioUrl: lesson.audioUrl,
    speaking: skill === "speaking" ? lesson.speaking ?? {goals:"",sentences:[]} : null,
    listening: skill === "listening" ? lesson.listening ?? {transcript:"",hideTranscriptFirstListen:true,questions:[]} : null,
    grammar:skill === "grammar" ? lesson.grammar ?? {topic:"",rules:"",commonMistakes:"",questions:[]} : null,
    writing:skill === "writing" ? {...blankWriting(),...lesson.writing} : null,
    reading:skill === "reading" ? {...blankReading(),...lesson.reading,questions:lesson.reading?.questions.map(question=>({...newReadingQuestion(question.type),...question}))??[]} : null };
}
export function blankReading():Reading { return {passageTitle:"",category:"",passage:"",translation:"",instructions:"",vocabulary:[],questions:[]}; }
export function blankWriting():Writing {
  return {taskType:"essay",topic:"",prompt:"",instructions:"",minWords:150,maxWords:250,sampleAnswer:"",rubric:[
    {name:"Đáp ứng yêu cầu đề bài",description:"Đúng chủ đề, đủ các ý được yêu cầu.",weight:25},
    {name:"Mạch lạc và liên kết",description:"Bố cục rõ ràng, các ý liên kết hợp lý.",weight:25},
    {name:"Từ vựng",description:"Dùng từ chính xác và phù hợp với ngữ cảnh.",weight:25},
    {name:"Ngữ pháp",description:"Cấu trúc câu, thì và dấu câu chính xác.",weight:25},
  ]};
}
export function countWords(text:string):number { return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length??0; }
export function newReadingQuestion(type:ReadingQuestion["type"]):ReadingQuestion {
  return {type,prompt:"",options:type==="multiple_choice"?["",""]:[],correctOptionIndex:type==="multiple_choice"?0:null,
    answer:type==="true_false_not_given"?"true":null,acceptedAnswers:[],caseSensitive:false,explanation:null,reference:null,focus:"scanning",points:1,
    pairs:type==="matching"?[{left:"",right:""},{left:"",right:""}]:[]};
}
export function newGrammarQuestion(type:GrammarQuestion["type"]):GrammarQuestion {
  return {type,prompt:"",options:type === "fill_blank"?[]:["",""],correctOptionIndex:type === "fill_blank"?null:0,
    answer:null,acceptedAnswers:[],caseSensitive:false,correction:null,tag:null,explanation:null};
}
export function newQuestion(type: Question["type"]): Question {
  return { type, prompt: "", options: type === "multiple_choice" ? ["", ""] : [], correctOptionIndex: type === "multiple_choice" ? 0 : null,
    answer: null, caseSensitive: false, explanation: "", atSeconds: null, pairs: type === "matching" ? [{left:"",right:""},{left:"",right:""}] : [] };
}
export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : {"Content-Type":"application/json"}), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errors = body.errors ? Object.values(body.errors).flat().join(" ") : null;
    throw new Error(response.status === 401 ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." : response.status === 403 ? "Bạn không có quyền quản trị." : errors || body.title || "Không thể thực hiện yêu cầu. Vui lòng thử lại.");
  }
  return body as T;
}
