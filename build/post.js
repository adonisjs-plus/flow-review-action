import { a as getState, i as getInput, l as warning, n as FlowServer, r as OIDC_AUDIENCE, t as getIdToken } from "./id_token-CXOJmNN9.js";
//#region src/revoke_token.ts
/** Revokes a GitHub App installation token, so it cannot be used after the run. */
async function revokeToken(token, fetchFn = fetch) {
	const response = await fetchFn(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/installation/token`, {
		method: "DELETE",
		headers: {
			"authorization": `Bearer ${token}`,
			"accept": "application/vnd.github+json",
			"x-github-api-version": "2022-11-28"
		}
	});
	if (!response.ok && response.status !== 401) throw new Error(`GitHub answered ${response.status}`);
}
//#endregion
//#region src/post.ts
/**
* Runs after the review, even when it fails or the job is cancelled. It
* tells the Flow App server that the run is done, then revokes the GitHub
* token. A failure here is a warning, since the review already ran.
*/
async function post() {
	const runId = getState("runId");
	const token = getState("token");
	const outcome = getState("outcome") || "cancelled";
	if (runId) try {
		await new FlowServer(getInput("server-url")).done(await getIdToken(OIDC_AUDIENCE), runId, outcome);
	} catch (error) {
		warning(`Cannot tell the Flow App that the run is done: ${error.message}`);
	}
	if (token) try {
		await revokeToken(token);
	} catch (error) {
		warning(`Cannot revoke the GitHub token: ${error.message}`);
	}
}
post();
//#endregion
export {};
