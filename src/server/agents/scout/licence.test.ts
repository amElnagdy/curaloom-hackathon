import { describe, expect, it } from "vitest";
import { classifyLicence } from "./licence.ts";

const URL = "https://example.org/page";

// Page text as the page fetcher returns it: tags dropped, a rel="license" link kept as its URL.
const WIKIPEDIA_EN =
  "Pivot table - Wikipedia https://creativecommons.org/licenses/by-sa/4.0/deed.en Jump to content Main menu " +
  "A pivot table is a table of values which are aggregations of groups of individual values. " +
  "This page was last edited on 2 October 2026. Page was rendered with Parsoid . Text is available under the " +
  "Creative Commons Attribution-ShareAlike 4.0 License ; additional terms may apply. By using this site, you agree to the Terms of Use.";
const WIKIPEDIA_RU =
  "Сводная таблица — Википедия https://creativecommons.org/licenses/by-sa/4.0/deed.ru Перейти к содержанию " +
  "Текст доступен по лицензии Creative Commons «С указанием авторства — С сохранением условий» (CC BY-SA) ; " +
  "в отдельных случаях могут действовать дополнительные условия.";

describe("classifyLicence", () => {
  it.each([
    {
      fixture: "CC BY in words",
      text: "This work is licensed under a Creative Commons Attribution 4.0 International License.",
      spdx: "CC-BY-4.0",
      use: "open",
    },
    {
      fixture: "CC BY-NC as a short id",
      text: "Course notes by A. Author. Content on this site is licensed under CC BY-NC 4.0 unless noted.",
      spdx: "CC-BY-NC-4.0",
      use: "personal_study",
    },
    {
      fixture: "CC BY-ND",
      text: "Licence : Creative Commons Attribution - Pas de Modification 4.0 International.",
      spdx: "CC-BY-ND-4.0",
      use: "personal_study",
    },
    {
      fixture: "MIT licence file",
      text: "MIT License Copyright (c) 2024 Example Docs Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files.",
      spdx: "MIT",
      use: "open",
    },
    {
      fixture: "Apache docs",
      text: "Documentation licensed under the Apache License, Version 2.0.",
      spdx: "Apache-2.0",
      use: "open",
    },
    {
      fixture: "CC0 with public-domain wording",
      text: "Текст передан в общественное достояние по CC0 1.0 Universal.",
      spdx: "CC0-1.0",
      use: "open",
    },
    {
      fixture: "public domain",
      text: "This textbook has been released into the public domain by its authors.",
      spdx: "LicenseRef-PublicDomain",
      use: "open",
    },
    {
      fixture: "Wikipedia (EN): head licence link and footer agree",
      text: WIKIPEDIA_EN,
      spdx: "CC-BY-SA-4.0",
      use: "open",
    },
    {
      fixture: "Wikipedia (RU): the version comes from the link only",
      text: WIKIPEDIA_RU,
      spdx: "CC-BY-SA-4.0",
      use: "open",
    },
    {
      fixture: "CSDN (ZH): version before the terms",
      text: "版权声明：本文为博主原创文章，遵循 CC 4.0 BY-SA 版权协议，转载请附上原文出处链接和本声明。",
      spdx: "CC-BY-SA-4.0",
      use: "open",
    },
    {
      fixture: "Wikiversité (FR): no version stated anywhere",
      text: "Les textes sont disponibles sous licence Creative Commons Attribution-partage dans les mêmes conditions ; d’autres conditions peuvent s’appliquer.",
      spdx: "CC-BY-SA",
      use: "open",
    },
    {
      fixture: "OpenStax: NC-SA named three ways",
      text: "This book uses the Creative Commons Attribution-NonCommercial-ShareAlike License. You must license the derivative work under the same CC-BY-NC-SA license. Except where otherwise noted, textbooks on this site are licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (CC BY NC-SA) license.",
      spdx: "CC-BY-NC-SA-4.0",
      use: "personal_study",
    },
    {
      fixture: "content CC BY 4.0, code samples Apache 2.0",
      text: "Except as otherwise noted, the content of this page is licensed under the Creative Commons Attribution 4.0 License, and code samples are licensed under the Apache 2.0 License.",
      spdx: "CC-BY-4.0",
      use: "open",
    },
    {
      fixture: "code under MIT, then the text under CC BY-SA",
      text: "The code in this book is released under the MIT License. The text is licensed under CC BY-SA 4.0.",
      spdx: "CC-BY-SA-4.0",
      use: "open",
    },
    {
      fixture: "an adaptation: the source CC BY, the page CC BY-SA",
      text: "Adapted from Spreadsheets 101 (CC BY 4.0). This page is shared under a CC BY-SA 4.0 license.",
      spdx: "CC-BY-SA-4.0",
      use: "open",
    },
    {
      fixture: "LibreTexts: the source CC BY, the page CC BY-NC-SA",
      text: "Adapted from Workplace Software and Skills by OpenStax, CC BY 4.0. This page is shared under a CC BY-NC-SA 4.0 license.",
      spdx: "CC-BY-NC-SA-4.0",
      use: "personal_study",
    },
    {
      fixture: "text CC BY, exercises CC BY-NC",
      text: "Text is licensed under CC BY 4.0. Exercises are licensed under CC BY-NC 4.0.",
      spdx: "CC-BY-NC-4.0",
      use: "personal_study",
    },
  ])("accepts $fixture as $spdx ($use)", ({ text, spdx, use }) => {
    const check = classifyLicence(text, URL);

    expect(check).toMatchObject({ spdx, use, evidence_url: URL });
    expect(check.quote.length).toBeGreaterThan(0);
    expect(text).toContain(check.quote.replace(/^…|…$/g, ""));
  });

  describe("on a long page, a term anywhere in the text counts", () => {
    const filler = "A pivot table groups rows and shows a total for each group. ".repeat(3_000);
    const page = (middle: string) =>
      [
        "This work is licensed under a Creative Commons Attribution 4.0 International License.",
        filler,
        middle,
        filler,
      ].join(" ");

    it("rejects a CC BY page that says all rights reserved in the middle", () => {
      const check = classifyLicence(page("© 2026 Example Corp. All rights reserved."), URL);

      expect(check).toMatchObject({
        use: "rejected",
        reason: expect.stringMatching(/all rights reserved/),
      });
    });

    it("makes a CC BY page personal study when it says NonCommercial in the middle", () => {
      const check = classifyLicence(
        page("Exercises may be reused for NonCommercial purposes."),
        URL,
      );

      expect(check).toMatchObject({ spdx: "CC-BY-4.0", use: "personal_study" });
      expect(check.reason).toContain("NonCommercial");
    });

    it("keeps CC BY for a page whose code samples are MIT in the middle", () => {
      const check = classifyLicence(page("Code samples are licensed under the MIT License."), URL);

      expect(check).toMatchObject({ spdx: "CC-BY-4.0", use: "open" });
      expect(check.quote).toContain("Creative Commons Attribution 4.0");
      expect(check.reason).toContain("MIT");
    });

    it("rejects a CC BY page that names a licence off the allowlist in the middle", () => {
      const check = classifyLicence(page("Code samples are licensed under the GPLv3."), URL);

      expect(check).toMatchObject({
        use: "rejected",
        reason: expect.stringMatching(/GPL is not on the allowlist/),
      });
    });
  });

  it("classifies a hostile page at the fetcher's 512 KB cap quickly", () => {
    const page = [
      `Creative Commons${" ".repeat(30_000)}x`,
      "общественн".repeat(5_000),
      "Pivot tables summarise data. CC BY-SA 4.0 ".repeat(6_000),
      "CC BY-SA ".repeat(15_000),
      "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License.",
    ].join(" ");

    const started = performance.now();
    const check = classifyLicence(page, URL);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(check).toMatchObject({ spdx: "CC-BY-SA-4.0", use: "open" });
    expect(check.quote).toContain("Creative Commons Attribution-ShareAlike 4.0 License.");
  });

  it("quotes the licence sentence rather than the bare link", () => {
    expect(classifyLicence(WIKIPEDIA_EN, URL).quote).toBe(
      "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License ;",
    );
  });

  it.each([
    {
      text: "The code in this book is released under the MIT License. The text is licensed under CC BY-SA 4.0.",
      quote: "The text is licensed under CC BY-SA 4.0.",
    },
    {
      text: "Adapted from Workplace Software and Skills by OpenStax, CC BY 4.0. This page is shared under a CC BY-NC-SA 4.0 license.",
      quote: "This page is shared under a CC BY-NC-SA 4.0 license.",
    },
  ])("on a page with several licences, quotes the one it cites: $quote", ({ text, quote }) => {
    expect(classifyLicence(text, URL).quote).toBe(quote);
  });

  it.each([
    {
      fixture: "all rights reserved",
      text: "© 2026 Example Training Ltd. All rights reserved.",
      reason: /all rights reserved/,
      quote: /All rights reserved/,
    },
    {
      fixture: "all rights reserved (ZH)",
      text: "著作权归作者所有。商业转载请联系作者获得授权。",
      reason: /all rights reserved/,
      quote: /著作权归作者所有/,
    },
    {
      fixture: "no licence statement",
      text: "Learn to build a pivot table in Excel, step by step, with practice files.",
      reason: /no licence statement/,
      quote: /^$/,
    },
    {
      fixture: "ambiguous: Creative Commons without its terms",
      text: "Portions of this content are by individual contributors. Content available under a Creative Commons license.",
      reason: /without its terms/,
      quote: /Creative Commons license/,
    },
    {
      fixture: "CC BY-SA beside a licence off the allowlist (GFDL)",
      text: "Text is available under the Creative Commons Attribution-ShareAlike 4.0 License and the GNU Free Documentation License.",
      reason: /GFDL is not on the allowlist/,
      quote: /GNU Free Documentation License/,
    },
    {
      fixture: "content CC BY, code under MPL 2.0",
      text: "Content is licensed under CC BY 4.0, and code samples under the Mozilla Public License 2.0.",
      reason: /MPL-2\.0 is not on the allowlist/,
      quote: /Mozilla Public License/,
    },
    {
      fixture: "ambiguous: a licence beside all rights reserved",
      text: "Licensed under CC BY-SA 4.0. © 2026 Example Corp. All rights reserved.",
      reason: /all rights reserved/,
      quote: /CC BY-SA 4\.0/,
    },
    {
      fixture: "an open licence not on the allowlist",
      text: "Unless otherwise specified, all text on this website is licensed under the Mozilla Public License v2.0.",
      reason: /MPL-2\.0 is not on the allowlist/,
      quote: /Mozilla Public License/,
    },
    {
      fixture: "an OER label without a licence",
      text: "This open educational resource (OER) was produced by the university library.",
      reason: /without its terms/,
      quote: /open educational resource/,
    },
  ])("rejects $fixture", ({ text, reason, quote }) => {
    const check = classifyLicence(text, URL);

    expect(check.use).toBe("rejected");
    expect(check.reason).toMatch(reason);
    expect(check.reason_ar).not.toBe("");
    expect(check.quote).toMatch(quote);
    expect(check.evidence_url).toBe(URL);
  });
});
