// Irrevocable local metadata receipts, never credentials. Caller provisions a private directory.
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { syntheticSha256, syntheticUuid } from "./metaInsightsExternalAuthorization.ts";

export type Reservation = "reserved" | "replay" | "storage_unavailable";
export function createDurableSyntheticAdmission(directory: string) {
  return { reserve(runId: string, requestSha256: string): Reservation {
    let directoryFd: number | undefined; let receiptFd: number | undefined;
    try {
      if (typeof directory !== "string" || !isAbsolute(directory) || resolve(directory) !== directory ||
        !syntheticUuid.test(runId) || !syntheticSha256.test(requestSha256) || typeof process.getuid !== "function") {
        return "storage_unavailable";
      }
      // Reject symlink ancestors, not only the final directory. A trusted local filesystem is required.
      let ancestor = parse(directory).root;
      for (const part of directory.slice(ancestor.length).split("/")) {
        ancestor = join(ancestor, part); if (lstatSync(ancestor).isSymbolicLink()) return "storage_unavailable";
      }
      directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const info = fstatSync(directoryFd);
      const sameDirectory = () => {
        const current = lstatSync(directory);
        return current.isDirectory() && current.dev === info.dev && current.ino === info.ino &&
          current.uid === process.getuid!() && (current.mode & 0o077) === 0;
      };
      if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || !sameDirectory()) {
        return "storage_unavailable";
      }
      const path = join(directory, `${runId}.json`);
      try {
        receiptFd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          const existing = lstatSync(path);
          return sameDirectory() && existing.isFile() && existing.nlink === 1 && existing.uid === process.getuid() &&
            (existing.mode & 0o777) === 0o600 ? "replay" : "storage_unavailable";
        }
        return "storage_unavailable";
      }
      const receipt = fstatSync(receiptFd);
      if (!receipt.isFile() || receipt.uid !== process.getuid() || receipt.nlink !== 1 || (receipt.mode & 0o777) !== 0o600) {
        return "storage_unavailable";
      }
      writeFileSync(receiptFd, JSON.stringify({ schema: "synthetic-admission-v1", runId, requestSha256 }), "utf8");
      fsyncSync(receiptFd);
      closeSync(receiptFd); receiptFd = undefined;
      fsyncSync(directoryFd);
      const current = lstatSync(path);
      if (!sameDirectory() || !current.isFile() || current.dev !== receipt.dev || current.ino !== receipt.ino ||
        current.uid !== receipt.uid || current.nlink !== 1 || (current.mode & 0o777) !== 0o600) return "storage_unavailable";
      return "reserved";
    } catch { return "storage_unavailable"; }
    finally {
      // Never unlink: even uncertain persistence, aborted or failed attempts burn this run.
      if (receiptFd !== undefined) { try { closeSync(receiptFd); } catch { /* Still closed to execution. */ } }
      if (directoryFd !== undefined) { try { closeSync(directoryFd); } catch { /* No credentials or deletion. */ } }
    }
  } };
}
