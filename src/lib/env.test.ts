import path from "node:path";

import { describe, expect, it } from "vitest";

import { EnvError, parseEnv, readSecretFiles } from "./env";

// A hash of "correct horse" (scripts/hash-password.ts).
const PASSWORD_HASH = "argon2id:m=19456,t=2,p=1:CLZW5wQoCjh3Q9CHBp_JWw:Ak2xS7TYlYYrhemlgBkVxFmWXfcMq_rjd0mJGZcZFfA";

const valid = {
  DOSSIER_PASSWORD: PASSWORD_HASH,
  DOSSIER_SECRET: "a".repeat(32),
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/dossier",
};

const withoutPassword = { DOSSIER_SECRET: valid.DOSSIER_SECRET, DATABASE_URL: valid.DATABASE_URL };

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("Expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts the required variables and fills in defaults", () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      DOSSIER_AUTH: "password",
      DOSSIER_ALLOW_INSECURE_LOGIN: false,
      DOSSIER_OIDC_ALLOWED_GROUPS: [],
      DOSSIER_OIDC_NAME: "Authentik",
      DOSSIER_DATA_DIR: "/data",
      DOSSIER_BACKUP_RETENTION_DAYS: 14,
      DOSSIER_TELEMETRY: "on",
    });
  });

  it("reads whether the usage ping is on", () => {
    expect(parseEnv({ ...valid, DOSSIER_TELEMETRY: "" }).DOSSIER_TELEMETRY).toBe("on");
    expect(parseEnv({ ...valid, DOSSIER_TELEMETRY: " Off " }).DOSSIER_TELEMETRY).toBe("off");
    expect(problems({ ...valid, DOSSIER_TELEMETRY: "false" })).toEqual(['DOSSIER_TELEMETRY must be on or off (got "false").']);
  });

  it("reads the optional variables", () => {
    const env = parseEnv({
      ...valid,
      DOSSIER_DATA_DIR: "/srv/dossier",
      DOSSIER_BACKUP_RETENTION_DAYS: "30",
      DOSSIER_AI_PROVIDER: "local",
      DOSSIER_AI_URL: "http://ollama:11434",
      DOSSIER_AI_MODEL: "llama3.1:8b",
      DOSSIER_AI_KEY: "sk-test",
    });
    expect(env).toMatchObject({
      DOSSIER_DATA_DIR: "/srv/dossier",
      DOSSIER_BACKUP_RETENTION_DAYS: 30,
      DOSSIER_AI_PROVIDER: "local",
      DOSSIER_AI_URL: "http://ollama:11434",
      DOSSIER_AI_MODEL: "llama3.1:8b",
      DOSSIER_AI_KEY: "sk-test",
    });
  });

  it("reads the AI timeout in seconds", () => {
    expect(parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: " 300 " }).DOSSIER_AI_TIMEOUT_SECONDS).toBe(300);
    expect(() => parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: "5m" })).toThrow(/whole number of seconds/);
    expect(() => parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: "1" })).toThrow(/at least 5/);
  });

  it("resolves a relative data directory", () => {
    const env = parseEnv({ ...valid, DOSSIER_DATA_DIR: "./data" });
    expect(env.DOSSIER_DATA_DIR).toBe(path.resolve("data"));
  });

  it("treats empty values as unset", () => {
    const env = parseEnv({ ...valid, DOSSIER_AI_KEY: "", DOSSIER_DATA_DIR: " " });
    expect(env.DOSSIER_AI_KEY).toBeUndefined();
    expect(env.DOSSIER_DATA_DIR).toBe("/data");
    expect(problems({ ...valid, DOSSIER_PASSWORD: "" })).toEqual([
      expect.stringMatching(/^DOSSIER_PASSWORD is not set\./),
    ]);
  });

  it("names every missing required variable", () => {
    expect(problems({})).toEqual([
      expect.stringMatching(/^DOSSIER_SECRET is not set\. .*openssl rand/),
      expect.stringMatching(/^DATABASE_URL is not set\. /),
    ]);
    expect(problems(withoutPassword)).toEqual([expect.stringMatching(/^DOSSIER_PASSWORD is not set\. Set it to/)]);
  });

  it("signs in with OIDC when an issuer is set, and then needs no password", () => {
    const oidc = {
      ...withoutPassword,
      DOSSIER_OIDC_ISSUER: "https://auth.example.com/application/o/dossier/",
      DOSSIER_OIDC_CLIENT_ID: "dossier",
      DOSSIER_OIDC_CLIENT_SECRET: "client-secret",
      DOSSIER_OIDC_ALLOWED_GROUPS: " family, ,admins ",
      DOSSIER_OIDC_OWNER: " Chris ",
    };
    expect(parseEnv(oidc)).toMatchObject({
      DOSSIER_AUTH: "oidc",
      DOSSIER_OIDC_ALLOWED_GROUPS: ["family", "admins"],
      DOSSIER_OIDC_OWNER: "chris",
      DOSSIER_OIDC_NAME: "Authentik",
    });
    expect(parseEnv(valid).DOSSIER_AUTH).toBe("password");
    expect(problems({ ...withoutPassword, DOSSIER_AUTH: "oidc" })).toEqual([
      expect.stringMatching(/^DOSSIER_OIDC_ISSUER is not set\./),
      expect.stringMatching(/^DOSSIER_OIDC_CLIENT_ID is not set\./),
      expect.stringMatching(/^DOSSIER_OIDC_CLIENT_SECRET is not set\./),
    ]);
    expect(problems({ ...valid, DOSSIER_ALLOW_INSECURE_LOGIN: "yes" })).toEqual([
      'DOSSIER_ALLOW_INSECURE_LOGIN must be true or false (got "yes").',
    ]);
  });

  it("reads secrets from <NAME>_FILE, without the trailing newline", () => {
    const files: Record<string, string> = { "/run/secrets/secret": "s".repeat(32) + "\n" };
    const read = (file: string) => {
      if (!(file in files)) throw new Error("ENOENT");
      return files[file];
    };
    expect(readSecretFiles({ DOSSIER_SECRET_FILE: "/run/secrets/secret" }, read)).toMatchObject({ DOSSIER_SECRET: "s".repeat(32) });
    // The variable itself wins.
    expect(readSecretFiles({ DOSSIER_SECRET: "x", DOSSIER_SECRET_FILE: "/run/secrets/secret" }, read).DOSSIER_SECRET).toBe("x");
    expect(() => readSecretFiles({ DATABASE_URL_FILE: "/missing" }, read)).toThrow(EnvError);
  });

  it("wants a hash of the password, not the password itself", () => {
    expect(problems({ ...valid, DOSSIER_PASSWORD: "correct horse" })).toEqual([
      expect.stringMatching(/^DOSSIER_PASSWORD must be a hash of your password, not the password itself\. .*hash-password/),
    ]);
    expect(parseEnv({ ...valid, DOSSIER_PASSWORD: ` ${PASSWORD_HASH}\n` }).DOSSIER_PASSWORD).toBe(PASSWORD_HASH);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(problems({ ...valid, DOSSIER_SECRET: "short" })).toEqual([
      expect.stringMatching(/^DOSSIER_SECRET is too short \(5 characters\)\./),
    ]);
  });

  it("never echoes secret values", () => {
    const messages = problems({
      DOSSIER_PASSWORD: "hunter2",
      DOSSIER_SECRET: "tiny-secret",
      DATABASE_URL: "mysql://root:db-password@db/dossier",
    }).join("\n");
    expect(messages).not.toContain("hunter2");
    expect(messages).not.toContain("tiny-secret");
    expect(messages).not.toContain("db-password");
    expect(messages).toMatch(/DATABASE_URL must be a PostgreSQL connection string/);
  });

  it("rejects invalid optional values", () => {
    expect(
      problems({
        ...valid,
        DOSSIER_BACKUP_RETENTION_DAYS: "two weeks",
        DOSSIER_AI_PROVIDER: "gemini",
        DOSSIER_AI_URL: "ftp://example.com",
      }),
    ).toEqual([
      'DOSSIER_BACKUP_RETENTION_DAYS must be a whole number of days (got "two weeks").',
      'DOSSIER_AI_PROVIDER must be one of local, openai, anthropic (got "gemini").',
      "DOSSIER_AI_URL must be an http:// or https:// URL.",
    ]);
    expect(problems({ ...valid, DOSSIER_BACKUP_RETENTION_DAYS: "0" })).toEqual([
      "DOSSIER_BACKUP_RETENTION_DAYS must be at least 1.",
    ]);
  });
});

describe("job search variables (E14-4)", () => {
  it("reads the source and its keys", () => {
    expect(
      parseEnv({
        ...valid,
        DOSSIER_JOBS_SOURCE: "jsearch",
        DOSSIER_JSEARCH_KEY: "ak_test",
        DOSSIER_JSEARCH_HOST: "rapidapi",
        DOSSIER_ADZUNA_APP_ID: "app",
        DOSSIER_ADZUNA_KEY: "adz",
      }),
    ).toMatchObject({
      DOSSIER_JOBS_SOURCE: "jsearch",
      DOSSIER_JSEARCH_KEY: "ak_test",
      DOSSIER_JSEARCH_HOST: "rapidapi",
      DOSSIER_ADZUNA_APP_ID: "app",
      DOSSIER_ADZUNA_KEY: "adz",
    });
  });

  it("rejects sources and hosts it doesn't know, without echoing keys", () => {
    expect(problems({ ...valid, DOSSIER_JOBS_SOURCE: "linkedin", DOSSIER_JSEARCH_HOST: "google", DOSSIER_JSEARCH_KEY: "ak_secret" })).toEqual([
      'DOSSIER_JOBS_SOURCE must be one of jsearch, adzuna, arbeitsagentur, off (got "linkedin").',
      'DOSSIER_JSEARCH_HOST must be openwebninja or rapidapi (got "google").',
    ]);
  });
});
