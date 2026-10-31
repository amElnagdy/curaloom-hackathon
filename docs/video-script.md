# Demo video script (#31)

A shot list for a video of at most 3:00, recorded on Nov 4 from `pnpm demo:replay` (#30) at 1440×900. Narration is Arabic with English subtitles. The pace is about 130 words a minute, so each row's English line is sized to its time.

Before recording:

- Run `pnpm demo:replay`, then open `http://localhost:3107/intake` in a clean browser window at 1440×900.
- Collapse the demo bar until shot 5 needs it.
- The demo bar's badge says the run is replayed from recorded model answers. Say so once in the narration (shot 2).

| Time      | Screen                                                                                                                                 | Narration (Arabic)                                                                                                                                                                            | Subtitle (English)                                                                                                                                                                                                                               | Fallback shot                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 0:00–0:20 | Title card, then Omar's intake chat empty                                                                                              | عمر محاسب في الرياض، يريد أن يصبح محلل بيانات، ووقته خمس ساعات في الأسبوع. ترك دورات كثيرة لأنها طويلة، وأغلب الشروح الجيدة ليست بالعربية.                                                      | Omar is an accountant in Riyadh who wants to become a data analyst, with five hours a week. Omar has dropped long courses before, and most good material is not in Arabic.                                                                       | Title card only                                 |
| 0:20–0:50 | /intake: the voice chip plays Omar's spoken message into the message box, then Omar's three messages, the agent's questions, then «تم» | يستطيع عمر أن يتكلم بدل أن يكتب، فيحوّل Muse Voice Transcribe صوته إلى نص يراجعه قبل الإرسال. ثم يتحدث مع وكيل المقابلة بلهجته. هذه نسخة مسجّلة من إجابات النماذج، والشارة أعلى الصفحة تقول ذلك. | Omar can speak instead of typing, and Muse Voice Transcribe turns the voice message into text to check before sending. Then Omar talks to the interview agent in a Gulf dialect. This run replays recorded model answers, and the badge says so. | Screenshot of the transcript in the message box |
| 0:50–1:10 | /plan building: activity column and trace drawer open                                                                                  | الكشّاف يبحث بالروسية والصينية والفرنسية والإنجليزية، ويتحقق من ترخيص كل مصدر. ثم يصمم المهندس دورة على وقت عمر.                                                                                | The scout searches in Russian, Chinese, French and English and checks every source's licence. Then the architect designs a course around Omar's time.                                                                                            | Plan page with the sources list open            |
| 1:10–1:35 | /lesson/L1: Arabic beside the source excerpt, a term card, the licences panel                                                          | كل درس عربي بجانب نصه الأصلي، مع بطاقة لكل مصطلح وترخيص كل مقتطف.                                                                                                                              | Each Arabic lesson sits beside its source, with a card for every term and the licence of every excerpt.                                                                                                                                          | Lesson screenshot with a term card pinned       |
| 1:35–1:55 | /quiz/L1: first attempt 75%, retry passes, lesson 2 opens                                                                              | لا يُفتح الدرس التالي إلا بثمانين في المئة. أخطأ عمر أولًا، ثم نجح في المحاولة الثانية.                                                                                                            | The next lesson opens only at 80%. Omar misses it first, then passes on the retry.                                                                                                                                                               | Quiz result screenshot                          |
| 1:55–2:15 | Demo bar: day 2 nudge, day 5 lighter-week offer, day 10 check-in on /coach                                                             | ثم يغيب عمر. المدرب يذكّره في اليوم الثاني، ويعرض أسبوعًا أخف في اليوم الخامس، ويسأله في اليوم العاشر. ولو كتب «توقف» لتوقف المدرب نهائيًا.                                                      | Then Omar goes quiet. The coach nudges on day 2, offers a lighter week on day 5 and checks in on day 10. If Omar writes "stop", it stops for good.                                                                                               | /coach with the three messages                  |
| 2:15–2:35 | Tap «جلسات أقصر», «افتح خطتي», the recap, then the proposal with the before and after days                                             | يطلب عمر جلسات أقصر. يراجع خمسة أسئلة، ثم يرى خطته الجديدة بجانب القديمة: كل جلسة فاتته نُقلت، وأسبوعه الأول أخف، والنموذج يشرح السبب.                                                          | Omar asks for shorter sessions, answers a five-question recap, and sees the new plan beside the old one: every missed session moved, a lighter first week, and the model explaining why.                                                         | Proposal screenshot                             |
| 2:35–2:42 | «اعتمد الخطة الجديدة», then /progress with versions 1 and 2                                                                            | لا يتغيّر شيء إلا بموافقته.                                                                                                                                                                      | Nothing changes until Omar agrees.                                                                                                                                                                                                               | Accepted plan screenshot                        |
| 2:42–2:52 | /lesson/L2: the pivot table with Arabic labels, then «الأصل» shows the source and «بالعربية» goes back                                  | وفي الدرس الثاني أعاد ‏Muse Image كتابة تسميات الرسم بالعربية، وتحقق الكود من النتيجة قبل أن يعرضها.                                                                                           | In lesson 2, Muse Image rewrote the diagram's labels in Arabic, and code checked the result before showing it.                                                                                                                                   | Screenshot of the Arabic pivot table            |
| 2:52–3:00 | Meta tooling card, then the closing card                                                                                               | ‏Muse Spark للمقابلة والبحث والدروس والمدرب، و‏Muse Wonder للدورة، و‏Muse Voice Transcribe للصوت، و‏Muse Image للرسوم.                                                                            | Muse Spark runs the interview, search, lessons and coach. Muse Wonder designs the course, Voice Transcribe hears voice, and Muse Image relabels diagrams.                                                                                        | Closing card only                               |

## Meta tooling card

What each model does, as `config/models.yaml` routes it:

- **Muse Spark 1.3:**
  - the interview (`agent_default`);
  - the scout's web search with citations and its description of each source (`agent_default`); code reads each source's page and verifies its licence;
  - lesson writing (`agent_default`);
  - quiz writing (`agent_default`) and grading of short answers (`judge`);
  - the coach's messages (`coach`);
  - the re-plan's explanation and the choice of a new source (`replan`);
  - reading a diagram's labels with the glossary (`diagram_labels`), and transcribing the source and each relabelled copy for the code check (`image_text`).
- **Muse Wonder 1.0:** the course design (`curriculum`).
- **Muse Voice Transcribe 1.0:** Omar's voice message in the interview (`transcribe`), as text to check before sending.
- **Muse Image 1.0:** a source diagram with its labels rewritten in Arabic (`image_edit`). Code edits only images whose licence allows it, and shows a legend when two edits fail its check.
- **Arabic quality** (#8, 30 items judged): Spark 0.98, Wonder 1.00, after Ahmed's ruling on one diacritics item.
- Code decides everything a model must not. It checks licences, grades multiple choice, enforces the 80% gate, checks every relabelled diagram, and makes every plan change (ADR-008).

## Presenter steps

The clicks are the numbered steps in [demo.md](demo.md#presenter-steps), walked twice on the replay build with no missing recording. Each shot covers these steps:

| Shot      | Steps in demo.md | What the viewer must see                                                                                                                                       |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:20–0:50 | 1 to 3           | The voice chip filling the message box with the transcript, each «املأ الرسالة المسجّلة» chip filling Omar's message, and the five facts filling in on the right |
| 0:50–1:10 | 4                | The activity column naming each agent's work, and the trace drawer with a model call's role and cost                                                           |
| 1:10–1:35 | 5                | A term card pinned, and «المصادر والتراخيص» open                                                                                                               |
| 1:35–1:55 | 6 and 7          | 75% under the 80% mark, then 100% and lesson 2 opening                                                                                                         |
| 1:55–2:15 | 8 and 9          | The three markers on the demo bar, and each message arriving on the phone                                                                                      |
| 2:15–2:35 | 10 and 11        | The recap in place on /plan, then the proposal with the lines from old days to new days                                                                        |
| 2:35–2:42 | 12 and 13        | Version 2 on /plan, and «تاريخ خطتك» on /progress                                                                                                              |
| 2:42–2:52 | 13               | Lesson 2's pivot table in Arabic, then «الأصل» and back to «بالعربية»                                                                                           |

Typed text replays only as recorded, so use the chips and pick the listed answers exactly.

## Timing

The scripted walk took 2:08 of app time at the demo pace. Building the plan and lesson 1 takes about 50 seconds, which is longer than its 25-second shot. Cut that wait in the edit and mark it on screen as sped up («مُسرَّع»), so the video stays honest about time.

Lesson 2's diagram arrives about 18 seconds after the lesson opens. Cut that wait too, marked «مُسرَّع».

In shot 2 the voice clip plays for 9 seconds. Let its first seconds play aloud, then lower it under the narration. The shot took 5 seconds from the plan build's shot, which is sped up anyway.

## Rehearsal

Rehearse on Nov 3 with `pnpm demo:replay`. Time each shot, and cut narration where a shot runs long. Reset between takes with `pnpm demo:reset` (see [demo.md](demo.md#reset)).
