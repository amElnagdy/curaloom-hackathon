# Running the demo (#30)

The demo runs the app on port 3107 for one sample learner, Omar. In replay, every model reply comes from a recording in `demo/fixtures/responses/`, so the demo needs no network and no API key. A badge in the top bar and on the demo bar says how the models answer: «ردود مسجّلة» `REPLAY`, «مباشر» `LIVE` or «يسجّل الآن» `RECORD`. Click or tap the badge, or focus it and press Enter, to read what the mode means.

## Commands

Each command except the reset builds the app and serves it on `http://localhost:3107`, or on the port `DEMO_PORT` sets in `.env` or the shell, from 1024 to 65535. When the port is taken, the command stops before the build and says so. Each command builds into its own folder, `.next/` for the replay, `.next-preview/` and `.next-live/`, and keeps its own data, so any two can run side by side on different ports, such as `DEMO_PORT=3118 pnpm demo:live` beside `pnpm demo:replay`. The presenter steps below use 3107. `pnpm demo:reset` empties all three demos' data, whatever their ports. `pnpm dev` keeps its own port and its own `data/`.

| Command            | Models                                | Pace                   | Data                               |
| ------------------ | ------------------------------------- | ---------------------- | ---------------------------------- |
| `pnpm demo:replay` | recorded                              | 0.3 × recorded latency | `.replay-data/`, emptied at start  |
| `pnpm preview`     | recorded                              | none                   | `.preview-data/`, emptied at start |
| `pnpm demo:live`   | live; needs `MODEL_API_KEY` in `.env` | real                   | `.live-data/`, emptied at start    |
| `pnpm demo:reset`  | none                                  | none                   | empties both folders               |

`demo/run.ts` runs all four. Replay always uses the recorded topic, `RECORDED_TOPIC` in `demo/script.ts`, whatever `DEMO_TOPIC` says. The live demo uses `DEMO_TOPIC` when it is set, and the recorded topic otherwise. Without a key, `pnpm demo:live` stops before it builds and says where to set the key.

## Pace

`REPLAY_LATENCY` sets the pace of replay. Replay waits each recording's latency times this number, then answers. `0` answers at once, as in the tests and `pnpm preview`. `pnpm demo:replay` uses `0.3` unless `REPLAY_LATENCY` is set in `.env` or the shell:

```sh
REPLAY_LATENCY=0.5 pnpm demo:replay
```

The recorded calls on the demo's path waited about 5 minutes in all. At `0.3`, a scripted browser walked the presenter steps below, from the intake to lesson 2's quiz, in 2 minutes 8 seconds. Its clicks were instant, so a presenter takes longer by the time they spend reading and clicking. That walk predates the voice chip in step 2, which adds about 10 seconds: the 9-second clip, then 0.8 seconds of replayed transcription.

At `0.3`, a scripted browser on the steps above saw lesson 1's diagram 45 seconds after the lesson opened, and lesson 2's 18 seconds after it opened at step 13. The trace shows the steps themselves taking 44 s and 18 s. The diagrams are their own step, asked for only once the lesson is written, so the plan and the lessons do not wait for them.

## Reset

To start the demo again from the beginning:

1. Wait until the activity column on the plan page says «لا يعمل أي وكيل الآن». A step still running when you reset can write its result into the emptied data.
2. Run `pnpm demo:reset`.
3. Reload the browser tab. The plan page shows the example plan again, and the interview is empty.

The demo bar's «إعادة» first asks «أتريد أن تبدأ العرض من الصفر؟». «نعم، ابدأ من الصفر» empties this session's data but keeps its trace, and the clock goes back to day 0. «تراجع» or Esc leaves everything as it was. The presenter steps do not use «إعادة», so it has no one-key shortcut. Between runs, use `pnpm demo:reset`.

Stopping the server and running `pnpm demo:replay` again gives the same start state.

## Typed text in replay

A recording answers only the request it was recorded for, word for word. In replay, the intake composer and every short-answer item of a recorded quiz show a dashed chip: «املأ الرسالة المسجّلة» or «املأ الإجابة المسجّلة». The chip puts the recorded text in the field, so the field shows what the model reads. The chips do not show in live mode.

Other text works too (#55). Before the model call, replay puts the recorded text in its place, so the request is still the recorded one. A line with the replay badge's icon says so where it happens, and the trace drawer shows a decision for each.

- **Intake:** a message, typed or a voice transcript, is sent as the recorded message at its place, 1, 2 or 3. The chat shows the recorded message, with «في العرض المسجّل أُرسلت الرسالة المسجّلة بدل رسالتك.» under it.
- **A quiz's short answers:** the examiner grades the recorded short answers to that quiz, from the run at the learner's level. The review labels each «الإجابة المسجّلة», and the result says why.
- **Lesson 1's second quiz:** it is the last quiz with recorded answers, since a third quiz has none. An attempt below 80% takes the keys of its wrong multiple-choice answers, so it passes. The result reads «اجتزت الاختبار في العرض المسجّل», and the review shows which answers were swapped.
- **Lesson 2's quiz:** the run never graded it. Its questions show for reading only, and «لا يصحّح العرض المسجّل هذا الاختبار، فأسئلته هنا للقراءة فقط.» stands in place of «سلّم الإجابات».

A result graded with recorded answers gives the score «مع الإجابات المسجّلة», not as the learner's own. Once the lesson's best score came that way, the lesson's foot and the plan's lesson strip say it was passed «في العرض المسجّل» in place of a score, and a best score below the gate reads «أفضل نتيجة» without «لك».

Live and record mode send the learner's own text.

## Voice in replay

In live mode the intake composer has a mic button. The learner records up to a minute, Muse Voice Transcribe turns it into text, and the text fills the composer for the learner to edit and send. A live recording never has a recording of its transcription, so replay shows no mic button. Replay offers a second chip before the first message instead: «استمع إلى الرسالة الصوتية المسجّلة وأرسلها للتفريغ». It plays `public/demo/omar-intake-1.wav` aloud, Omar's first message spoken by macOS's Arabic voice, then posts the clip to the same transcribe route. The route replays the clip's recorded transcription into the composer, and the trace drawer shows the call with its role, model and cost. Turn the sound on to hear the clip.

The transcript is not word for word the typed message: «هلا وله انا محاسب بشركة في الرياض من خمس سنين وابي اتحول لمحلل بيانات», against «هلا والله. أنا محاسب…». The recorded interview was made with the typed text, so the transcript has no recording of the interviewer's reply. After the transcript fills the composer, click «املأ الرسالة المسجّلة (١ من ٣)». It replaces the transcript with the typed message, and you send that. Sending the transcript as it is also works: replay sends the typed message in its place, as «Typed text in replay» says.

The recorded interview stays as it was recorded, on purpose. Re-recording it with the transcript as message 1 would change every interviewer reply after it, so the saved profile's goal and notes would change too. The scout's brief and every lesson request carry the profile, so the whole demo would have to be recorded again, and the quiz answers in the presenter steps rewritten.

To make the clip again, run `say -v Majed -o msg.aiff "<text>"`, then `afconvert -f WAVE -d LEI16@16000 -c 1 msg.aiff public/demo/omar-intake-1.wav`. The text is the first message of `INTAKE_MESSAGES`, with diacritics on «مُحاسِب», «الرِّياض», «أَتَحَوَّل» and «مُحَلِّل», which made the voice say them clearly enough to transcribe. A new clip needs a new recording of its transcription, made by `pnpm fixtures:record`.

## Presenter steps

This is Omar's recorded path, the beginner's, walked in a browser at 1440×900 on `pnpm demo:replay`. Answer as written to see the run as it was recorded. The short check in step 3 can also place the learner at the intermediate or the advanced level, whose paths are recorded too. «Other levels», below the steps, says what changes on them, and «Paths off this list» says what replay does with other answers elsewhere.

1. Run `pnpm demo:replay` and wait for `Ready`. Open `http://localhost:3107/intake` in a clean browser window at 1440×900.
2. In the chat, click «استمع إلى الرسالة الصوتية المسجّلة وأرسلها للتفريغ». The clip plays for 9 seconds, then its transcript fills the composer. Click «املأ الرسالة المسجّلة (١ من ٣)», which replaces the transcript with the recorded text, then «أرسل». Wait for the interviewer's reply. For (٢ من ٣) and (٣ من ٣), click the chip, then «أرسل».
3. In the short check, pick «لا أعرف بعد» in all three questions, as Omar's run did. Scroll down inside the chat and click «أرسل إجاباتك». Two right answers place the learner at the intermediate level and three at the advanced one, and each level plays its own recorded path from step 4 on.
4. Scroll down the page and click «اذهب إلى خطتك». The plan page builds the plan, then writes lesson 1, in about 50 seconds. When «ابدأ الدرس الأول» in the activity column turns blue, click it.
5. Lesson 1 opens with a quiet line after its sections: «يبحث مُعرِّب الرسوم في مصادر هذا الدرس عن رسم…». About 45 seconds later the VisiCalc screenshot appears under the first section, with a two-column table of its labels in Arabic. Its two relabelled samples failed the code check, so the lesson shows the source, and the trace drawer shows both samples and why each failed. You do not have to wait for it. At the end of lesson 1, click «ابدأ الاختبار». While the quiz is still being written, the button reads «إلى الاختبار».
6. First attempt. Pick these answers, then click «املأ الإجابة المسجّلة» under questions 5 and 6, and click «سلّم الإجابات». The score is 75%.
   - Question 1: «المصنف (classeur) ملف يجمع ورقة عمل…».
   - Question 2: «بحذف القيم القديمة وإعادة كتابة المجاميع يدويا…». This is the wrong answer, on purpose.
   - Question 3: «توليد خلاصة تلخص الجدول الكبير…».
   - Question 4: «تعرض الصفوف التي تحقق شرط بند الإيجار فقط…».
7. Click «ابدأ اختبارًا جديدًا». Pick these answers, fill questions 5 and 6 with the chips, and click «سلّم الإجابات». The score is 100%, and lesson 2 opens.
   - Question 1: «برنامج جداول البيانات (tableur) هو البرنامج الذي يعرض الشبكة ويحسبها آليا…».
   - Question 2: «معادلة ضرب تشير إلى خليتي الكمية والسعر…».
   - Question 3: «المصنف ملف واحد للسنة يضم أوراقا مستقلة…».
   - Question 4: «التصفية تعرض سطور الرواتب فقط…».
8. Click the shield in the side rail, «الموافقة». Turn on «رسائل المدرب», keep the other settings, and click «وافق وفعّل الرسائل».
9. Click the phone in the side rail, «رسائل المدرب». In a window under 700 px tall, such as 1440×900 at 150% zoom, the demo bar starts as a chip, «أداة العرض»: click it to open the bar. On the demo bar, click the marker «اليوم ٢، تذكير», then «اليوم ٥، أسبوع أخف», then «اليوم ١٠، سؤال». Wait for each message on the phone before the next click.
10. On the phone, tap «جلسات أقصر». When the coach answers, tap «افتح خطتي» under its answer.
11. The plan page opens on «أهلًا بعودتك يا عمر». Answer the five review questions, three right and two wrong, then click «سلّم الإجابات». The proposed version 2 appears with Spark's note under «لماذا تغيّرت؟».
    - Question 1: «بتخزين معادلة تجمع أو تطرح قيم خلايا أخرى…».
    - Question 2: «المصنف (classeur) ملف يجمع ورقة عمل…».
    - Question 3: «توليد خلاصة تلخص الجدول الكبير…».
    - Question 4: «ترتب الصفوف من الأكبر إلى الأصغر…».
    - Question 5: «برنامج جداول البيانات (tableur) هو خلية واحدة…».
12. Click «اعتمد الخطة الجديدة».
13. Click the chart in the side rail, «التقدّم». «تاريخ خطتك» shows versions 1 and 2. Click lesson 2, «ما الجدول المحوري ولماذا يستخدمه محلل البيانات», to open it. About 18 seconds later the pivot table appears under its second section with Arabic labels. The plan's acceptance starts writing lesson 2, so if you open it within about 20 seconds of step 12, the diagram waits for that too: a scripted walk saw it 32 seconds after opening. «الأصل» above it shows the source, and «بالعربية» goes back.

Other levels (#98):

- The intermediate and advanced paths run the same steps on recordings of their own: their own plan, lessons, quizzes, coach messages and re-plan. The interviewer's closing reply says what the level means for the plan, and no note says the plan follows another level.
- Diagrams differ by level. On the intermediate path, lesson 1 has no diagram and lesson 2 gets the relabelled pivot table. On the advanced path, neither lesson has one. Where a lesson has none, the line «يبحث مُعرِّب الرسوم…» goes once the diagrams agent is done.
- The picks in steps 6, 7 and 11 answer the beginner's quizzes. On the other levels, miss any two multiple-choice items in step 6, as their runs did, and answer every item right in step 7. The chips fill each short item with the quiz's own model answer, which is what those runs sent. The advanced run's first attempt scored 67% and its retry 100%. In step 11, answer three of the five right.

Paths off this list:

- Other text in steps 2, 6 and 7 is replaced by the recorded text, as «Typed text in replay» says. So are wrong answers in step 7.
- Two other paths have recordings at every level, played by the chain test: «مصدر آخر» in step 10 with the review answered as in step 11, and «جلسات أقصر» with a review of 4 or 5 right.

Replay keeps these paths to the recorded run (#55), at every level. Each says so in one line where it happens, except the coach's two, which only the trace drawer shows. The trace drawer shows a decision for each:

- The coach asks the model only for a message whose wording has a recording: the three in step 9. Any other message goes as its template, such as lesson 1's messages when the clock moves before it is passed, the weekly message from day 17, or a message after the comeback whose brief differs from a recorded one. `hasRecording()` in `src/server/providers/provider.ts` decides from the recordings themselves, with the request the coach would send.
- The coach writes to the learner's own plan in the tone «لطيف», whatever the consent screen says.
- Opening the plan page between the day 2 marker and the tap in step 10 starts no comeback. The plan page says the comeback starts from «جلسات أقصر» or «مصدر آخر» at the day 10 check-in. A reply in your own words starts none either.
- «استراحة أسبوع» in step 10 pauses the coach until day 17, as it would live. The run has no comeback after it, so the plan page says the recorded comeback follows only «جلسات أقصر» or «مصدر آخر», and that «إعادة» on the demo bar starts the demo again to try one.
- The run has one comeback: on day 10, on the ladder from day 0, after lesson 1 was passed on day 0. Any other is held back, and the plan page says so and points to «إعادة»: a second comeback, one after lesson 1 was passed on a later day or not at all, and one finished after day 10, since the re-plan's request carries the day.
- «مصدر آخر» after a review of 4 or 5 right: the run has no re-plan for it, so replay grades the recorded review, 3 right of 5, in its place. The review result calls it «المراجعة المسجّلة». The plan and Spark's note are then the recorded ones.
- The plan's session editor checks a change, but says the recorded demo keeps the plan as built, in place of «احفظ».

The scripted walk and the chain tests found no other path on these pages that reaches a request with no recording.

## The scripted walk

`pnpm e2e` clicks through presenter steps 1 to 13 in Chromium with Playwright, against the built app. Run `pnpm build` first, and `pnpm exec playwright install chromium` once to download the browser.

Each test starts its own replay server on emptied data in a temporary folder, unpaced, as `pnpm preview` runs. The server listens on port 3190, or on `E2E_PORT`, so the walk runs beside `pnpm dev` and `pnpm preview`. The walk answers the short check three ways, in three tests: «لا أعرف بعد» in all three questions (beginner), two right and «لا أعرف بعد» (intermediate), and all three right (advanced). Each level walks its own recordings, so the walk reads each quiz's keys, the recap's keys and lesson 2's title from the session's files, and it waits for each lesson's diagram, or for the diagrams step to end with none where that level's run found none (`DIAGRAMS`). It checks that no level shows the note or traces the swap. More tests leave the path where «Paths off this list» says replay keeps the learner on it. One types its own intake messages and short answers, retries lesson 1's quiz with two wrong picks, checks that the lesson and the plan say it was passed in the recorded demo, picks the tone «عادي», opens the plan page on day 2, taps «مصدر آخر» and answers the review all right, then opens lesson 2's quiz. It runs at the beginner's level and again at the intermediate one. The last taps «استراحة أسبوع» in step 10 and moves on to day 17. They find each replay note by its role, `note`. A request with no recording fails the walk at once with the server's log line for it, and at the end each test checks the trace for calls and pages that had no recording. The six tests take about a minute locally and about two minutes in CI. CI runs the walk after `pnpm build`.

The walk clicks the typed-text chips, not the voice chip in step 2, and it checks what each step shows, not how the pages look. Each test keeps its server's log in `e2e/test-results/`, and a test that fails keeps its Playwright trace there too. When the walk fails, CI uploads that folder as the `e2e-test-results` artifact.

`pnpm e2e` also runs `e2e/shell.e2e.ts`, on one replay server for the file (#66). It scrolls `/plan`, `/lesson`, `/quiz`, `/coach`, `/consent`, `/settings` and `/progress` at 1440×900, at 150% zoom and on a phone, with the demo bar as it starts and as the viewer opens it, and fails when the demo bar or the trace tab sits on a page element. It also opens the mode badge with Enter, Space and a tap, and checks that «إعادة» sends no reset until it is confirmed. It takes about 10 seconds.

## When a recording is missing

A request with no recording fails at once. It does not wait for a timeout. A page the scout fetches with no recording fails the same way.

- The server log prints `[replay] No recorded response for request <hash> (/responses, responses-<model>-<hash>.json)`, or `[replay] No recorded page for <url> (<file>)` for a page.
- The trace drawer shows the failed call. Its English summary names the hash or the page file; its Arabic summary does not.
- A red banner under the top bar says in Arabic which step stopped, that this part of the demo or one of the sources' pages is not recorded, and that a retry will not help. It does not guess why. It offers «ابدأ العرض من جديد» and «التفاصيل في سجل الوكلاء», and shows no hash or file name. Its close button hides it in this tab. At phone width it scrolls with the page.
- The page's step fails as a model failure does. Where the lesson, its quiz or its diagram stopped on the missing recording, the failure shows no «حاول مرة أخرى», and the banner's restart is the way back. The quiz page keeps its retry. The coach is the exception. It sends its template message instead, and the banner still shows. In replay the coach never gets here: it checks for the recording first.
- The plan page is the exception for the scout and the architect. When a plan build stopped on a missing recording, the page says so as soon as the build answers and from the first render after that, offers «ابدأ العرض من جديد» in place of «حاول مرة أخرى», and does not build again when reloaded. It shows no banner.

«ابدأ العرض من جديد» empties the demo's data as the reset does and opens the interview. The banner goes with it in this tab, also when the simulated clock is off and the restart only forgets the interview. It also goes after a reset, or when the failed step later plays its recording. In the intake, click the chip and send the recorded text again.

To fix it, record the request as described next. The hash names the file the recording goes in.

The short check never leads here. The scout's, the architect's and the lesson builder's requests carry the learner's level. `RECORDED_LEVELS` in `demo/script.ts` lists the levels replay plays on their own recordings: all three since #98. In replay, `requestLevel()` in `src/server/agents/recorded-level.ts` would send a level not listed as the first one listed, the beginner's, with a note under the interviewer's closing reply and on the plan page, and one trace event for the swap. The learner's profile keeps their own level. Live and record modes send the learner's level.

The chain test's blocks "the intermediate presenter path" and "the advanced presenter path" walk each level on its own recordings, with the replay paths above. On these paths every short answer is the quiz's own model answer, which the quiz writer is told earns full credit, and the first attempt at lesson 1's quiz misses two multiple-choice items to land under 80%. `recordedShortAnswers()` in `demo/script.ts` gives each level's short answers, Omar's words for the beginner. The quiz page's chips and the examiner read them through `replayShortAnswers()` in `src/server/agents/recorded-level.ts`, with the level the learner's requests carry and the quiz. Lesson 2 of the intermediate path gets the relabelled pivot table; its lesson 1 and both lessons of the advanced path get no diagram, because no image on their pages has a licence the diagrams agent accepts.

To add a level to the recorded demo:

1. Record its whole presenter path: the scout, the architect, lessons 1 and 2 and their diagrams, lesson 1's two quizzes and the comeback review with their grading, the coach's messages and the comeback's re-plan. The lessons and quizzes are written from the plan, so a level with only its plan recorded stops at lesson 1. Add the level to the chain test's per-level `describe.each`, which answers the check at that level and walks the path. Record the plan first with `RECORD_FIXTURES=1 pnpm exec vitest run src/server/agents/intake/intake.test.ts -t "<level> presenter path.*places him"` and read it. One advanced plan kept every rule, but its rationale and its first lessons were about other subjects. The architect's topic check (#109) now sends such a plan back for its retry, but it compares words, not meaning, so still read the plan; move one that reads off its subject out of `demo/fixtures/responses/` and record again. Then record the rest with `-t "<level> presenter path"` and run `pnpm fixtures:prune`.
2. Only then add the level to `RECORDED_LEVELS`. `requestLevel()` swaps a whole level or none of it, so once the level is listed, every request for it carries it, and `replayShortAnswers()` asks `recordedShortAnswers()` for that level's answers.
3. Change that level's walk in `e2e/replay.e2e.ts` with it: its placement no longer borrows (`borrowed: false`), `FIRST_MISSED` gives the multiple-choice items its run missed on lesson 1's first quiz, and `DIAGRAMS` gives the lessons its run shows a diagram in.

Steps 1 and 2 change `demo/fixtures/` and `demo/script.ts`, which the replay freeze covers from Nov 3.

## Re-recording

From Nov 3, 2026, the recordings are frozen. Do not change a prompt, a contract, `config/models.yaml`, `demo/script.ts` or a fixture, because replay would have no recording for the changed request. `docs/release-checklist.md` ("Replay freeze") has the full lists, the checks to run before merging, and the cost of a re-record.

`pnpm fixtures:prune` deletes every recording that no test replays. A recording made by clicking through a server in record mode is therefore deleted by the next prune. Record through the tests instead. The chain test in `src/server/agents/intake/intake.test.ts` walks the demo's path through the HTTP API with the text in `demo/script.ts`.

After a prompt or contract change, on the same topic:

1. Set `MODEL_API_KEY` in `.env`.
2. Run `pnpm fixtures:record`. It calls the models only for requests that have no recording.
3. Run `pnpm fixtures:prune`.
4. Check the new files in `demo/fixtures/responses/` for the API key and the learner id `l_omar`. The name «عمر» belongs only in a request that gives the model the learner's name, as the intake's does.
5. Walk the presenter steps on `pnpm demo:replay`.

The diagrams agent's pages are recorded as HTML (`"kind": "html"` in the recording), and replay runs the reading code in `src/server/agents/diagrams/wiki.ts` on them, so a change to that code needs no new recording. `pnpm fixtures:prune` prunes only `demo/fixtures/responses/`. A page recording no test reads stays until you delete it.

To add a path to the demo, add it to the chain test first, then record. The tests for the comeback's «مصدر آخر» path and for lesson 2 under the accepted v2 are examples.

On a new topic:

1. Set `RECORDED_TOPIC` in `demo/script.ts` and `DEMO_TOPIC` in `.env` to the topic.
2. To record the scout, run `rm -rf data/sessions/demo data/cache/scout`, then `PROVIDER_PROFILE=record DEMO_TOPIC="<topic>" pnpm scout`. The scout section of `docs/architecture.md` explains this step.
3. Rewrite `INTAKE_MESSAGES` in `demo/script.ts` if Omar's messages no longer fit the topic.
4. Run `pnpm fixtures:record`. The quiz tests fail at this point, because `SHORT_ANSWERS` answer the old quiz.
5. Read the new quizzes in their recordings. Rewrite `SHORT_ANSWERS` so that the first attempt scores under 80% and the retry passes, then run `pnpm fixtures:record` again.
6. Run `pnpm fixtures:prune`, check the new files as above, and walk the presenter steps.

No run has re-recorded the demo on a new topic yet.
