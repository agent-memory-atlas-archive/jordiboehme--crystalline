import { describe, expect, it } from "vitest";

import { domainNameOf, withDomainName } from "./domainName";

const TEXT =
  "---\ntitle: Eng\ndomain_name: eng\ntype: manifest\n---\n\n# Eng\n";

describe("domainNameOf", () => {
  it("reads a plain value", () => {
    expect(domainNameOf(TEXT)).toBe("eng");
  });

  it("reads quoted values without their quotes", () => {
    expect(domainNameOf('---\ndomain_name: "eng team"\n---\n')).toBe(
      "eng team",
    );
    expect(domainNameOf("---\ndomain_name: 'eng'\n---\n")).toBe("eng");
  });

  it("drops a trailing comment and reads CRLF text", () => {
    expect(domainNameOf("---\r\ndomain_name: eng # old\r\n---\r\n")).toBe(
      "eng",
    );
  });

  it("answers null when there is no such line or no frontmatter", () => {
    expect(domainNameOf("---\ntitle: Eng\n---\n")).toBeNull();
    expect(domainNameOf("# Eng\ndomain_name: eng\n")).toBeNull();
    expect(domainNameOf("---\ndomain_name:\n---\n")).toBeNull();
  });

  it("ignores a line in the body", () => {
    expect(domainNameOf("---\ntitle: Eng\n---\ndomain_name: eng\n")).toBeNull();
  });
});

describe("withDomainName", () => {
  it("changes only that line", () => {
    expect(withDomainName(TEXT, "ops")).toBe(
      "---\ntitle: Eng\ndomain_name: ops\ntype: manifest\n---\n\n# Eng\n",
    );
  });

  it("keeps the quotes the line wore", () => {
    expect(withDomainName('---\ndomain_name: "eng"\n---\n', "ops")).toBe(
      '---\ndomain_name: "ops"\n---\n',
    );
    expect(withDomainName("---\ndomain_name: 'eng'\n---\n", "ops")).toBe(
      "---\ndomain_name: 'ops'\n---\n",
    );
  });

  it("keeps CRLF endings", () => {
    expect(withDomainName("---\r\ndomain_name: eng\r\n---\r\n", "ops")).toBe(
      "---\r\ndomain_name: ops\r\n---\r\n",
    );
  });

  it("adds the line under the fence when the text has none", () => {
    expect(withDomainName("---\ntitle: Eng\n---\n", "ops")).toBe(
      "---\ndomain_name: ops\ntitle: Eng\n---\n",
    );
  });
});
