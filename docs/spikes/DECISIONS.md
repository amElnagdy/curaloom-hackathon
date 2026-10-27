# Spike decisions (Epic #1)

| Spike | Decision | Date | Summary | Details |
|---|---|---|---|---|
| #7 API access from Egypt | **GO** | 2026-10-27 | All 8 models and features work from Cairo with a standard key. Recommended main protocol: `/responses`. A web-search query costs about $0.085. Ahmed confirmed the Geographic Use Policy allows use from Egypt (#10). | [api-access.md](api-access.md) |
| #8 Arabic quality eval | **GO** | 2026-10-27 | Both models pass every bar on 30 items: Spark 1.3 scores 0.97 and Wonder 1.0 scores 0.98. Spark does the agent work and Wonder keeps curriculum design. Ahmed's spot-check passed; the disputed diacritics item (fatha on خوارزمية) is correct. Mitigations: the glossary owns each term and its tashkeel, the English term goes in parentheses, and quiz options are shuffled in code. The two saved runs cost $0.90. | [arabic-eval.md](arabic-eval.md) |
| #9 Muse Image Arabic text + SAM | pending | | | |
| #10 Rules and submission | **OK (Ahmed)** | 2026-10-27 | Ahmed checked the hackathon rules and the Geographic Use Policy and found no blocker. The detailed answers (non-Meta models, TTS, video length, submission fields) are not yet written up in `rules.md`. | |
