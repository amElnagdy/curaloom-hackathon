# Running the demo (#30)

The demo runs the app on port 3107 for one sample learner, Omar. In replay, every model reply comes from a recording in `demo/fixtures/responses/`, so the demo needs no network and no API key. A badge in the top bar and on the demo bar says how the models answer: «ردود مسجّلة» `REPLAY`, «مباشر» `LIVE` or «يسجّل الآن» `RECORD`.

## Commands

Each command except the reset builds the app and serves it on `http://localhost:3107`. `pnpm dev` keeps its own port and its own `data/`.

| Command            | Models                                | Pace                   | Data                               |
| ------------------ | ------------------------------------- | ---------------------- | ---------------------------------- |
| `pnpm demo:replay` | recorded                              | 0.3 × recorded latency | `.preview-data/`, emptied at start |
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

Stopping the server and running `pnpm demo:replay` again gives the same start state.

## Typed text in replay

A recording answers only the request it was recorded for, word for word. In replay, the intake composer and every short-answer item of a recorded quiz show a dashed chip: «املأ الرسالة المسجّلة» or «املأ الإجابة المسجّلة». The chip puts the recorded text in the field. Send it as it is. Other text has no recording, and the step fails as described below. The chips do not show in live mode.

## Voice in replay

In live mode the intake composer has a mic button. The learner records up to a minute, Muse Voice Transcribe turns it into text, and the text fills the composer for the learner to edit and send. A live recording never has a recording of its transcription, so replay shows no mic button. Replay offers a second chip before the first message instead: «استمع إلى الرسالة الصوتية المسجّلة وأرسلها للتفريغ». It plays `public/demo/omar-intake-1.wav` aloud, Omar's first message spoken by macOS's Arabic voice, then posts the clip to the same transcribe route. The route replays the clip's recorded transcription into the composer, and the trace drawer shows the call with its role, model and cost. Turn the sound on to hear the clip.

The transcript is not word for word the typed message: «هلا وله انا محاسب بشركة في الرياض من خمس سنين وابي اتحول لمحلل بيانات», against «هلا والله. أنا محاسب…». The recorded interview was made with the typed text, so the transcript has no recording of the interviewer's reply. After the transcript fills the composer, click «املأ الرسالة المسجّلة (١ من ٣)». It replaces the transcript with the typed message, and you send that.

The recorded interview stays as it was recorded, on purpose. Re-recording it with the transcript as message 1 would change every interviewer reply after it, so the saved profile's goal and notes would change too. The scout's brief and every lesson request carry the profile, so the whole demo would have to be recorded again, and the quiz answers in the presenter steps rewritten.

To make the clip again, run `say -v Majed -o msg.aiff "<text>"`, then `afconvert -f WAVE -d LEI16@16000 -c 1 msg.aiff public/demo/omar-intake-1.wav`. The text is the first message of `INTAKE_MESSAGES`, with diacritics on «مُحاسِب», «الرِّياض», «أَتَحَوَّل» and «مُحَلِّل», which made the voice say them clearly enough to transcribe. A new clip needs a new recording of its transcription, made by `pnpm fixtures:record`.

## Presenter steps

This is the recorded path, walked in a browser at 1440×900 on `pnpm demo:replay`. Answer exactly as written. A different pick or text changes the next request, and that request has no recording.

1. Run `pnpm demo:replay` and wait for `Ready`. Open `http://localhost:3107/intake` in a clean browser window at 1440×900.
2. In the chat, click «استمع إلى الرسالة الصوتية المسجّلة وأرسلها للتفريغ». The clip plays for 9 seconds, then its transcript fills the composer. Click «املأ الرسالة المسجّلة (١ من ٣)», which replaces the transcript with the recorded text, then «أرسل». Wait for the interviewer's reply. For (٢ من ٣) and (٣ من ٣), click the chip, then «أرسل».
3. In the short check, pick «لا أعرف بعد» in all three questions. Scroll down inside the chat and click «أرسل إجاباتك».
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
9. Click the phone in the side rail, «رسائل المدرب». On the demo bar, click the marker «اليوم ٢، تذكير», then «اليوم ٥، أسبوع أخف», then «اليوم ١٠، سؤال». Wait for each message on the phone before the next click.
10. On the phone, tap «جلسات أقصر». When the coach answers, tap «افتح خطتي» under its answer.
11. The plan page opens on «أهلًا بعودتك يا عمر». Answer the five review questions, three right and two wrong, then click «سلّم الإجابات». The proposed version 2 appears with Spark's note under «لماذا تغيّرت؟».
    - Question 1: «بتخزين معادلة تجمع أو تطرح قيم خلايا أخرى…».
    - Question 2: «المصنف (classeur) ملف يجمع ورقة عمل…».
    - Question 3: «توليد خلاصة تلخص الجدول الكبير…».
    - Question 4: «ترتب الصفوف من الأكبر إلى الأصغر…».
    - Question 5: «برنامج جداول البيانات (tableur) هو خلية واحدة…».
12. Click «اعتمد الخطة الجديدة».
13. Click the chart in the side rail, «التقدّم». «تاريخ خطتك» shows versions 1 and 2. Click lesson 2, «ما الجدول المحوري ولماذا يستخدمه محلل البيانات», to open it. About 18 seconds later the pivot table appears under its second section with Arabic labels. The plan's acceptance starts writing lesson 2, so if you open it within about 20 seconds of step 12, the diagram waits for that too: a scripted walk saw it 32 seconds after opening. «الأصل» above it shows the source, and «بالعربية» goes back.

Paths off this list:

- Do not open the plan page between the day 2 marker and the tap in step 10. The plan page would start a comeback on day 2 or 5, and that comeback has no recording.
- Keep the coach's tone at «لطيف». The coach's request carries the tone.
- Two other paths have recordings, played by the chain test: «مصدر آخر» in step 10 with the review answered as in step 11, and «جلسات أقصر» with a review of 4 or 5 right. A browser has not walked them.

## When a recording is missing

A request with no recording fails at once. It does not wait for a timeout.

- The server log prints `[replay] No recorded response for request <hash> (/responses, responses-<model>-<hash>.json)`.
- The trace drawer shows the failed call with the same hash.
- A red banner under the top bar names the agent and the hash.
- The page's step fails as a model failure does, with its retry button. The coach is the exception. It sends its template message instead, and the banner still shows.

The banner stays until the next reset. The failed step can still play its recording. In the intake, click the chip and send the recorded text again.

To fix it, record the request as described next. The hash names the file the recording goes in.

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
