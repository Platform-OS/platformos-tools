import { Dependencies } from '../types';

/**
 * A trimmed platformOS GraphQL schema, for checks that infer something from a query.
 *
 * A FIXTURE, not a copy of the real thing: the actual SDL is ~300 KB and arrives at
 * runtime from the docset (`platformosDocset.graphQL()`), which is why no package
 * vendors it. What is reproduced here are the three facts that change a shape:
 *
 * - `results` is a LIST, so `.first` reaches an item and `.size` is a number;
 * - a custom scalar (`HashObject`) holds a hash at runtime, so it is not a primitive
 *   — `Record.properties.color` is legitimate;
 * - `related_record` nests another `Record`, so a selection can recurse.
 */
export const RECORDS_SDL = `
type Query {
  records(page: Int, per_page: Int, filter: RecordFilter): RecordCollection
}

input RecordFilter {
  id: IdFilter
}

input IdFilter {
  value: ID
}

type RecordCollection {
  total_entries: Int
  total_pages: Int
  results: [Record!]!
}

type Record {
  id: ID
  created_at: String
  name: String
  properties(select: [String!]): HashObject
  property(name: String): String
  property_int(name: String): Int
  property_array(name: String): [String!]
  property_upload(name: String): Upload
  related_record(table: String, join_on_property: String, foreign_property: String): Record
}

type Upload {
  url: String
  versions: HashObject
}

scalar HashObject
`;

/**
 * Dependencies whose docset knows one thing: the given GraphQL SDL. Everything else a
 * `PlatformOSDocset` answers comes back empty, so a check under test sees the schema
 * and nothing it did not ask for.
 */
export function dependenciesWithSchema(sdl: string): Partial<Dependencies> {
  return {
    platformosDocset: {
      async graphQL() {
        return sdl;
      },
      async filters() {
        return [];
      },
      async objects() {
        return [];
      },
      async liquidDrops() {
        return [];
      },
      async tags() {
        return [];
      },
    },
  };
}
