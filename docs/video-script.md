# Demo video script (#31)

A shot list for a video of at most 3:00, recorded on Nov 4 from `pnpm demo:replay` (#30) at 1440×900. Narration is Arabic with English subtitles. The pace is about 130 words a minute, so each row's English line is sized to its time.

Before recording:

- Run `pnpm demo:replay`, then open `http://localhost:3107/intake` in a clean browser window at 1440×900.
- Collapse the demo bar until shot 5 needs it.
- The demo bar's badge says the run is replayed from recorded model answers. Say so once in the narration (shot 2).

| Time      | Screen                                                                                     | Narration (Arabic)                                                                                                                       | Subtitle (English)                                                                                                                                                                       | Fallback shot                             |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0:00–0:20 | Title card, then Omar's intake chat empty                                                  | عمر محاسب في الرياض، يريد أن يصبح محلل بيانات، ووقته خمس ساعات في الأسبوع. ترك دورات كثيرة لأنها طويلة، وأغلب الشروح الجيدة ليست بالعربية. | Omar is an accountant in Riyadh who wants to become a data analyst, with five hours a week. Omar has dropped long courses before, and most good material is not in Arabic.               | Title card only                           |
| 0:20–0:45 | /intake: Omar's three messages, the agent's questions, then «تم»                           | يتحدث عمر مع وكيل المقابلة بلهجته. هذه نسخة مسجّلة من إجابات النماذج، والشارة في الأسفل تقول ذلك.                                          | Omar talks to the interview agent in a Gulf dialect. This run replays recorded model answers, and the badge says so.                                                                     | Screenshot of the finished interview      |
| 0:45–1:10 | /plan building: activity column and trace drawer open                                      | الكشّاف يبحث بالروسية والصينية والفرنسية والإنجليزية، ويتحقق من ترخيص كل مصدر. ثم يصمم المهندس دورة على وقت عمر.                           | The scout searches in Russian, Chinese, French and English and checks every source's licence. Then the architect designs a course around Omar's time.                                    | Plan page with the sources list open      |
| 1:10–1:35 | /lesson/L1: Arabic beside the source excerpt, a term card, the licences panel              | كل درس عربي بجانب نصه الأصلي، مع بطاقة لكل مصطلح وترخيص كل مقتطف.                                                                         | Each Arabic lesson sits beside its source, with a card for every term and the licence of every excerpt.                                                                                  | Lesson screenshot with a term card pinned |
| 1:35–1:55 | /quiz/L1: first attempt 75%, retry passes, lesson 2 opens                                  | لا يُفتح الدرس التالي إلا بثمانين في المئة. أخطأ عمر أولًا، ثم نجح في المحاولة الثانية.                                                       | The next lesson opens only at 80%. Omar misses it first, then passes on the retry.                                                                                                       | Quiz result screenshot                    |
| 1:55–2:15 | Demo bar: day 2 nudge, day 5 lighter-week offer, day 10 check-in on /coach                 | ثم يغيب عمر. المدرب يذكّره في اليوم الثاني، ويعرض أسبوعًا أخف في اليوم الخامس، ويسأله في اليوم العاشر. ولو كتب «توقف» لتوقف المدرب نهائيًا. | Then Omar goes quiet. The coach nudges on day 2, offers a lighter week on day 5 and checks in on day 10. If Omar writes "stop", it stops for good.                                       | /coach with the three messages            |
| 2:15–2:40 | Tap «جلسات أقصر», «افتح خطتي», the recap, then the proposal with the before and after days | يطلب عمر جلسات أقصر. يراجع خمسة أسئلة، ثم يرى خطته الجديدة بجانب القديمة: كل جلسة فاتته نُقلت، وأسبوعه الأول أخف، والنموذج يشرح السبب.     | Omar asks for shorter sessions, answers a five-question recap, and sees the new plan beside the old one: every missed session moved, a lighter first week, and the model explaining why. | Proposal screenshot                       |
| 2:40–2:50 | «اعتمد الخطة الجديدة», then /progress with versions 1 and 2                                | لا يتغيّر شيء إلا بموافقته.                                                                                                                 | Nothing changes until Omar agrees.                                                                                                                                                       | Accepted plan screenshot                  |
| 2:50–3:00 | Meta tooling card, then the closing card                                                   | ‏Muse Spark للمقابلة والبحث والدروس والاختبارات والمدرب، و‏Muse Wonder لتصميم الدورة.                                                       | Muse Spark runs the interview, search, lessons, quizzes and coach; Muse Wonder designs the course.                                                                                       | Closing card only                         |

## Meta tooling card

What each model does, as `config/models.yaml` routes it:

- **Muse Spark 1.3:**
  - the interview (`agent_default`);
  - the scout's web search with citations and its licence checks (`agent_default`);
  - lesson writing (`agent_default`);
  - quiz writing (`agent_default`) and grading of short answers (`judge`);
  - the coach's messages (`coach`);
  - the re-plan's explanation and the choice of a new source (`replan`).
- **Muse Wonder 1.0:** the course design (`curriculum`).
- **Arabic quality** (#8, 30 items judged): Spark 0.98, Wonder 1.00, after Ahmed's ruling on one diacritics item.
- Code decides everything a model must not. It checks licences, grades multiple choice, enforces the 80% gate, and makes every plan change (ADR-008).

## Presenter steps

To fill from #30's tested path: what to click and what to pick at each shot, with the replay chips for typed text.

## Rehearsal

To do on Nov 3 with `pnpm demo:replay`. Time each shot, and cut narration where a shot runs long.
