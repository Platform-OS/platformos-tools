/**
 * Bound the diagnostics one response carries, and say so when anything is withheld.
 *
 * IT RUNS AFTER ASSEMBLY, and that ordering is the design: this module never computes the
 * gate, never re-derives `status`, and never sees an unassembled diagnostic. It takes
 * finished results — whose verdict was computed from the COMPLETE set — and removes entries
 * from the tails of their lists, so no ordering of operations here can soften the gate.
 * `response-budget.spec.ts` asserts that with a buffer whose only blocking error sorts last.
 *
 * WHAT IS SPENT FIRST. The budget belongs to the whole request, so a batch cannot multiply
 * it, and it is allocated in two orders at once:
 *
 *   BY SEVERITY   every file's errors before any file's warnings, warnings before infos.
 *   BY FILE       round-robin within each severity, in the order the caller listed them, so
 *                 one file with thousands of findings cannot starve the others.
 *
 * Within a file and bucket, entries are taken from the FRONT, so what survives is the head
 * of a list already ordered by line and column — where the root cause of a cascade is.
 *
 * A STREAM THAT CANNOT FIT IS CLOSED, not skipped: once a bucket's next entry does not fit
 * it takes nothing further, so the returned list stays a contiguous head rather than a
 * scattered sample.
 *
 * ONE ERROR PER FILE IS GUARANTEED, budget or not — a blocked write with an empty `errors`
 * list names a problem and then declines to say what it is. Bounded: one entry per file,
 * and the batch form already caps files.
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
 * Measured on the thing that is actually sent — the JSON — rather than estimated from a
 * field count, because `hint`, `suggestion` and `fix` make entries vary by an order of
 * magnitude. The `+ 1` is the separating comma.
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
    // Written for an agent that reads only this object, and kept SHORT: it repeats per
    // file. Two claims earn their bytes — the list is partial, and the verdict is not.
    note:
      `Showing ${returned} of ${total} findings, from the top of the file; the rest were withheld to bound ` +
      `this response. "status" and "must_fix_before_write" reflect all ${total}. Fix these and validate again.`,
  };
}

/**
 * Apply the response bound to a whole request's results.
 *
 * Pure: returns new results, in the same iteration order, leaving the inputs alone. A result
 * with nothing withheld is returned unchanged and carries no `truncated` field, so the
 * field's presence is a reliable signal.
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
