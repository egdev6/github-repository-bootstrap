// Assemble paths only. Callers retain their own validation and enablement rules.
export function fixedTemplatePaths(issueFormDestinations, pullRequest) {
  return [
    ".github/ISSUE_TEMPLATE/config.yml",
    ...issueFormDestinations,
    ...(pullRequest ? [".github/pull_request_template.md"] : []),
  ];
}
