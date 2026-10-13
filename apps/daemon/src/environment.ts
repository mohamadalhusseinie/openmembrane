export function isGitHubCredentialVariable(name: string): boolean {
  return /^(?:GH|GITHUB)_(?:.*_)?(?:TOKEN|PAT|PASSWORD|SECRET)$/i.test(name);
}

export function daemonEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.keys(env).filter((name) => !isGitHubCredentialVariable(name))
    .map((name) => [name, env[name]]));
}
