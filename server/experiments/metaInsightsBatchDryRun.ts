// Inert on import. No env-file loading, secret lookup, HTTPS, DB or server startup.
import { pathToFileURL } from "node:url";
import { runBatchExperiment } from "./metaInsightsBatchExperiment.ts";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(argument => argument !== "--dry-run")) {
    console.error(JSON.stringify({ outcome: "pilot_not_authorized", realMetaValidated: false }));
    process.exitCode = 1;
  } else {
    const now = Date.now();
    const until = Math.floor(now / 86400000) * 86400;
    const report = await runBatchExperiment({ pageId: "123456", graphApiVersion: "v26.0",
      metric: "page_media_view", period: "day", since: until - 86400, until }, { now });
    console.log(JSON.stringify(report));
    if (report.outcome !== "available" && report.outcome !== "not_available") process.exitCode = 1;
  }
}
