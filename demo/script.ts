// The demo's recorded run (#30): the topic it was recorded on and the text Omar types, word for word.
// The chain test in src/server/agents/intake/intake.test.ts records the model's replies to exactly
// this text, and a replay matches a request only by its exact text, so in replay the intake and quiz
// pages offer this text to the presenter (docs/demo.md).

import type { LearnerProfile } from "../contracts/index.ts";

// The sample topic every recording is made on: the demo topic is not decided.
export const RECORDED_TOPIC = "Excel pivot tables for data analysis";

// The placement levels the recorded run has recordings for (#55). Omar answers «لا أعرف بعد» to all
// three questions, so every recording is a beginner's. The scout's, the architect's and the lesson
// builder's requests name the level, so replay plays any other level from the first one here
// (src/server/agents/recorded-level.ts). Add a level only once its whole presenter path is recorded
// (docs/demo.md, "When a recording is missing").
export const RECORDED_LEVELS: readonly [
  LearnerProfile["diagnostic"]["level"],
  ...LearnerProfile["diagnostic"]["level"][],
] = ["beginner"];

// Omar's intake messages, in Gulf dialect, in order. He answers what a first interview asks,
// whatever the model's wording.
export const INTAKE_MESSAGES: readonly string[] = [
  "هلا والله. أنا محاسب بشركة في الرياض من خمس سنين، وأبي أتحول لمحلل بيانات.",
  "أشتغل على الإكسل كل يوم، بس عمري ما سويت تحليل بيانات صدق. وقتي ضيق، تقريبًا خمس ساعات بالأسبوع.",
  "عادي عندي أي لغة دامها توصلني بالعربي. سجلت بكورسات كورسيرا قبل وما كملتها، كانت طويلة وأملّ بسرعة. وبعد لا تطرشون لي رسايل الصبح.",
];

// His first message spoken, under public/ so the intake page can fetch it (#37). macOS's one Arabic
// voice made it, as docs/demo.md («Voice in replay») says. Its transcription is recorded; in replay
// the page plays it and fills the composer with the transcript.
export const INTAKE_VOICE_CLIP = "/demo/omar-intake-1.wav";

// His short answers to the first quiz of lesson 1, in order: the first earns full credit by its
// rubric, the second only half (it filters but never summarises by branch).
const FIRST_QUIZ = [
  "أسوي ورقة لكل شهر في نفس المصنف، وأحط أعمدة التاريخ والبيان والمدين والدائن والرصيد. خانة الرصيد أكتب فيها معادلة تاخذ الرصيد اللي فوقها وتزيد المدين وتنقص الدائن، فلو غيرت أي مبلغ يتعدل الرصيد بروحه.",
  "أفلتر على كل فرع بروحه وأشوف مبيعاته شهر شهر، وبعدين أرسل الجدول للمدير.",
] as const;

// His short answers to the retry quiz of lesson 1, each earning full credit by its rubric.
const RETRY_QUIZ = [
  "أسوي مصنف واحد للسنة فيه ثلاث أوراق: ورقة العملاء فيها التاريخ والعميل والمبلغ والمحصل، وورقة الموردين بنفس الأعمدة تقريبا، وورقة الملخص الشهري. خلايا الملخص ما أكتبها بيدي، أحط فيها معادلات تجمع من ورقة العملاء وورقة الموردين، فأي تعديل هناك يتحدث هنا على طول. وبعدين أسوي رسم بياني من الملخص وأعرضه على الإدارة.",
  "أقول له لا تخاف، الفلتر ما يمسح شي، بس يخبي الصفوف اللي ما تبيها مؤقتا، ولو شلت الفلتر ترجع كلها. مثلا في جدول مدفوعات الموردين أفلتر على مورد واحد وأراجع دفعاته. والجدول المحوري بدل ما أجمع بيدي يطلع لي إجمالي المدفوع لكل مورد في كل شهر في جدول صغير، وهذا اللي تبيه الإدارة.",
] as const;

// His short answers by lesson id, then by the lesson's quiz in order (the first, then the retry).
export const SHORT_ANSWERS = { L1: [FIRST_QUIZ, RETRY_QUIZ] } as const;

// The recorded short answers to the `n`th quiz of a lesson (0 for its first), if the run has them.
export const recordedShortAnswers = (lessonId: string, n: number): readonly string[] | undefined =>
  (SHORT_ANSWERS as Record<string, readonly (readonly string[])[]>)[lessonId]?.[n];
