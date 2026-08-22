import { PlatformOSFileType } from './path-utils';

/**
 * The attribute types the platform accepts for a schema property.
 *
 * From `CustomAttributes::CustomAttribute::VALID_ATTRIBUTE_TYPES`, which the model validates
 * with a case-sensitive `inclusion:`. Measured on a live instance — a real deploy, because
 * `--dry-run` returns before the nested converter runs: both `not_a_real_type` and `String`
 * are REJECTED with `Attribute type ... is not allowed`, failing the whole changeset.
 */
export const SCHEMA_PROPERTY_TYPES = [
  'string',
  'integer',
  'float',
  'decimal',
  'datetime',
  'time',
  'date',
  'binary',
  'boolean',
  'array',
  'address',
  'file',
  'photo',
  'text',
  'geojson',
  'upload',
] as const;

/**
 * The file types whose `properties:` are converted by `CustomAttributeConverter` — every
 * converter declaring `convert :properties, using: CustomAttributeConverter`, so all four
 * share {@link SCHEMA_PROPERTY_TYPES}. Confirmed on a live instance for both a `schema/`
 * table and `user.yml`.
 */
export const PROPERTY_BEARING_FILE_TYPES: ReadonlySet<PlatformOSFileType> = new Set([
  PlatformOSFileType.Table,
  PlatformOSFileType.TransactableType,
  PlatformOSFileType.UserProfileType,
  PlatformOSFileType.UserSchema,
]);
