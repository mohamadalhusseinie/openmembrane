import { afterEach, expect, it, vi } from "vitest";
import { ExecFileCommandRunner } from "@openmembrane/service";
import { daemonEnvironment } from "../../../apps/daemon/src/environment";

afterEach(() => { vi.unstubAllEnvs(); });

it("excludes GitHub credentials case-insensitively while retaining configuration and caller environment", () => {
  const credentials = {
    GH_TOKEN: "test-token", GITHUB_TOKEN: "test-token", GH_ENTERPRISE_TOKEN: "test-token",
    GITHUB_ENTERPRISE_TOKEN: "test-token", github_token: "test-token", GH_PAT: "test-token",
    GITHUB_CLIENT_SECRET: "test-secret", GITHUB_PASSWORD: "test-password",
  };
  const configuration = {
    PATH: "test-path", HOME: "test-home", USERPROFILE: "test-profile", GH_CONFIG_DIR: "test-config",
    GH_HOST: "github.example.test", GITHUB_API_URL: "test-url", GH_PROMPT_DISABLED: "1",
  };
  const env = { ...credentials, ...configuration };
  expect(daemonEnvironment(env)).toEqual(configuration);
  expect(env).toEqual({ ...credentials, ...configuration });
});

it("filters credentials again at subprocess execution, including variables added after runner creation", async () => {
  const runner = new ExecFileCommandRunner(() => daemonEnvironment());
  vi.stubEnv("GH_TOKEN", "test-gh-token");
  vi.stubEnv("GITHUB_TOKEN", "test-github-token");
  vi.stubEnv("GH_ENTERPRISE_TOKEN", "test-enterprise-token");
  vi.stubEnv("GITHUB_ENTERPRISE_TOKEN", "test-enterprise-token");
  vi.stubEnv("GH_CONFIG_DIR", "test-config");
  const result = await runner.run({
    executable: process.execPath,
    args: ["-e", "console.log(JSON.stringify({credentials:Object.keys(process.env).filter(k=>/^(GH|GITHUB)_(.*_)?(TOKEN|PAT|PASSWORD|SECRET)$/i.test(k)),config:process.env.GH_CONFIG_DIR,pathPresent:!!process.env.PATH}))"],
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ credentials: [], config: "test-config", pathPresent: true });
  expect(process.env.GH_TOKEN).toBe("test-gh-token");
});
