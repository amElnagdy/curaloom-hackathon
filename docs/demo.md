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

The recorded calls on the demo's path waited about 5 minutes in all. At `0.3`, a scripted browser walked the presenter steps below, from the intake to lesson 2's quiz, in 2 minutes 8 seconds. Its clicks were instant, so a presenter takes longer by the time they spend reading and clicking.

## Reset

To start the demo again from the beginning:

1. Wait until the activity column on the plan page says «لا يعمل أي وكيل الآن». A step still running when you reset can write its result into the emptied data.
2. Run `pnpm demo:reset`.
3. Reload the browser tab. The plan page shows the example plan again, and the interview is empty.

Stopping the server and running `pnpm demo:replay` again gives the same start state.

## Typed text in replay

A recording answers only the request it was recorded for, word for word. In replay, the intake composer and every short-answer item of a recorded quiz show a dashed chip: «املأ الرسالة المسجّلة» or «املأ الإجابة المسجّلة». The chip puts the recorded text in the field. Send it as it is. Other text has no recording, and the step fails as described below. The chips do not show in live mode.

## Presenter steps

This is the recorded path, walked in a browser at 1440×900 on `pnpm demo:replay`. Answer exactly as written. A different pick or text changes the next request, and that request has no recording.

1. Run `pnpm demo:replay` and wait for `Ready`. Open `http://localhost:3107/intake` in a clean browser window at 1440×900.
2. In the chat, click «املأ الرسالة المسجّلة (١ من ٣)», then «أرسل». Wait for the interviewer's reply. Do the same for (٢ من ٣) and (٣ من ٣).
3. In the short check, pick «لا أعرف بعد» in all three questions. Scroll down inside the chat and click «أرسل إجاباتك».
4. Scroll down the page and click «اذهب إلى خطتك». The plan page builds the plan, then writes lesson 1, in about 50 seconds. When «ابدأ الدرس الأول» in the activity column turns blue, click it.
5. At the end of lesson 1, click «إلى الاختبار».
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
13. Click the chart in the side rail, «التقدّم». «تاريخ خطتك» shows versions 1 and 2. Click lesson 2, «ما الجدول المحوري ولماذا يستخدمه محلل البيانات», to open it.

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

`pnpm fixtures:prune` deletes every recording that no test replays. A recording made by clicking through a server in record mode is therefore deleted by the next prune. Record through the tests instead. The chain test in `src/server/agents/intake/intake.test.ts` walks the demo's path through the HTTP API with the text in `demo/script.ts`.

After a prompt or contract change, on the same topic:

1. Set `MODEL_API_KEY` in `.env`.
2. Run `pnpm fixtures:record`. It calls the models only for requests that have no recording.
3. Run `pnpm fixtures:prune`.
4. Check the new files in `demo/fixtures/responses/` for the API key and the learner id `l_omar`. The name «عمر» belongs only in a request that gives the model the learner's name, as the intake's does.
5. Walk the presenter steps on `pnpm demo:replay`.

To add a path to the demo, add it to the chain test first, then record. The tests for the comeback's «مصدر آخر» path and for lesson 2 under the accepted v2 are examples.

On a new topic:

1. Set `RECORDED_TOPIC` in `demo/script.ts` and `DEMO_TOPIC` in `.env` to the topic.
2. To record the scout, run `rm -rf data/sessions/demo data/cache/scout`, then `PROVIDER_PROFILE=record DEMO_TOPIC="<topic>" pnpm scout`. The scout section of `docs/architecture.md` explains this step.
3. Rewrite `INTAKE_MESSAGES` in `demo/script.ts` if Omar's messages no longer fit the topic.
4. Run `pnpm fixtures:record`. The quiz tests fail at this point, because `SHORT_ANSWERS` answer the old quiz.
5. Read the new quizzes in their recordings. Rewrite `SHORT_ANSWERS` so that the first attempt scores under 80% and the retry passes, then run `pnpm fixtures:record` again.
6. Run `pnpm fixtures:prune`, check the new files as above, and walk the presenter steps.

No run has re-recorded the demo on a new topic yet.
