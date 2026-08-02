/**
 * Bound the diagnostics one response carries, and say so when anything is withheld.
 *
 * WHY THIS RUNS AFTER ASSEMBLY, and why that ordering is the whole design. The one
 * way a cap can do real harm is by dropping the diagnostic that was holding the gate
 * shut: an agent handed `must_fix_before_write: false` and a shortened list writes a
 * file the server knows is broken. That is a FALSE APPROVAL manufactured by an
 * ergonomics fix, and it would only ever happen on large inputs, which is where
 * nobody is looking.
 *
 * So this module never computes the gate, never re-derives `status`, and never sees
 * an unassembled diagnostic. It takes finished results — whose `status` and
 * `must_fix_before_write` were computed by `assembleResult` from the COMPLETE set —
 * and removes entries from the tails of their lists. There is no ordering of
 * operations here that could soften the gate, because nothing here can write it.
 * `response-budget.spec.ts` asserts that anyway, with a buffer whose only blocking
 * error sorts last.
 *
 * WHAT IS SPENT FIRST. The budget belongs to the whole request, so a batch cannot
 * multiply it, and it is allocated in two orders at once:
 *
 *   BY SEVERITY   every file's errors are served before any file's warnings, and
 *                 warnings before infos. An error is what an agent must act on; an
 *                 info is what it may.
 *   BY FILE       round-robin within each severity, in the order the caller listed
 *                 them. One file with thousands of findings cannot starve the others
 *                 — which is the realistic shape, since a single cascading syntax
 *                 error produces exactly that.
 *
 * Within a file and bucket, entries are taken from the FRONT, so what survives is the
 * head of a list already ordered by line and column: the top of the file, which is
 * where the root cause of a cascade almost always is.
 *
 * A STREAM THAT CANNOT FIT IS CLOSED, not skipped. Once a bucket's next entry does
 * not fit, that bucket takes nothing further, even if a later entry were smaller.
 * Otherwise the returned list would be a sample scattered through the file rather
 * than a contiguous head, and `returned: 12 of 300` would tell an agent nothing about
 * WHICH twelve.
 *
 * ONE ERROR PER FILE IS GUARANTEED, budget or not. A blocked write with an empty
 * `errors` list is the least useful answer this server could give — it names a
 * problem and then declines to say what it is. The guarantee is bounded: at most one
 * entry per file, and the batch form already caps files at 50.
 */
import { MAX_RESPONSE_DIAGNOSTIC_BYTES } from '../cost-model.js';
import type {
  ValidateCodeBucketTruncation,
  ValidateCodeDiagnostic,
  ValidateCodeResult,
  ValidateCodeTruncation,
} from './types.js';

/** The buckets, in the order the budget is spent on them. */
const BUCKETS = ['errors', 'warnings', 'infos'] as const;
type Bucket = (typeof BUCKETS)[number];

/**
 * What one diagnostic costs in the serialized response.
 *
 * Measured on the thing that is actually sent — the JSON — rather than estimated
 * from a field count, because `hint`, `suggestion` and `fix` make entries vary by an
 * order of magnitude and it is the big ones a byte budget exists to notice. The `+ 1`
 * is the separating comma.
 */
function costOf(diagnostic: ValidateCodeDiagnostic): number {
  return Buffer.byteLength(JSON.stringify(diagnostic), 'utf8') + 1;
}

/** One file's bucket, mid-allocation. */
interface Stream {
  key: string;
  bucket: Bucket;
  entries: ValidateCodeDiagnostic[];
  taken: number;
  open: boolean;
}

function truncationFor(
  result: ValidateCodeResult,
  taken: Record<Bucket, number>,
): ValidateCodeTruncation | undefined {
  const withheld: Partial<Record<Bucket, ValidateCodeBucketTruncation>> = {};
  let total = 0;
  let returned = 0;

  for (const bucket of BUCKETS) {
    const found = result[bucket].length;
    total += found;
    returned += taken[bucket];
    if (taken[bucket] < found) {
      withheld[bucket] = { returned: taken[bucket], total: found };
    }
  }

  if (Object.keys(withheld).length === 0) return undefined;

  return {
    ...withheld,
    // Written for an agent that reads only this object, and kept SHORT on purpose:
    // this repeats per file, and at the 50-file batch limit a verbose sentence costs
    // more than the diagnostics it is apologising for. Two claims earn their bytes —
    // the list is partial, and the verdict above is not.
    note:
      `Showing ${returned} of ${total} findings, from the top of the file; the rest were withheld to bound ` +
      `this response. "status" and "must_fix_before_write" reflect all ${total}. Fix these and validate again.`,
  };
}

/**
 * Apply the response bound to a whole request's results.
 *
 * Pure: returns new results, in the same iteration order, leaving the inputs alone.
 * A result with nothing withheld is returned unchanged and carries no `truncated`
 * field at all, so the field's presence is a reliable signal rather than a stub an
 * agent has to inspect.
 */
export function capToBudget(
  results: ReadonlyMap<string, ValidateCodeResult>,
  budgetBytes: number = MAX_RESPONSE_DIAGNOSTIC_BYTES,
): Map<string, ValidateCodeResult> {
  const streams: Stream[] = [];
  for (const [key, result] of results) {
    for (const bucket of BUCKETS) {
      streams.push({ key, bucket, entries: result[bucket], taken: 0, open: true });
    }
  }

  let spent = 0;

  // The guarantee, taken first and charged honestly: it can push `spent` past the
  // budget before the loop below starts, in which case that loop admits nothing more.
  for (const stream of streams) {
    if (stream.bucket !== 'errors' || stream.entries.length === 0) continue;
    spent += costOf(stream.entries[0]);
    stream.taken = 1;
  }

  for (const bucket of BUCKETS) {
    const inBucket = streams.filter((stream) => stream.bucket === bucket);
    // Round-robin: one entry from each file in turn, until every stream in this
    // bucket is exhausted or closed by the budget.
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const stream of inBucket) {
        if (!stream.open || stream.taken >= stream.entries.length) continue;
        const cost = costOf(stream.entries[stream.taken]);
        if (spent + cost > budgetBytes) {
          stream.open = false;
          continue;
        }
        spent += cost;
        stream.taken += 1;
        progressed = true;
      }
    }
  }

  const takenByKey = new Map<string, Record<Bucket, number>>();
  for (const stream of streams) {
    const counts = takenByKey.get(stream.key) ?? { errors: 0, warnings: 0, infos: 0 };
    counts[stream.bucket] = stream.taken;
    takenByKey.set(stream.key, counts);
  }

  const capped = new Map<string, ValidateCodeResult>();
  for (const [key, result] of results) {
    const taken = takenByKey.get(key)!;
    const truncated = truncationFor(result, taken);

    if (!truncated) {
      capped.set(key, result);
      continue;
    }

    capped.set(key, {
      ...result,
      errors: result.errors.slice(0, taken.errors),
      warnings: result.warnings.slice(0, taken.warnings),
      infos: result.infos.slice(0, taken.infos),
      truncated,
    });
  }

  return capped;
}
