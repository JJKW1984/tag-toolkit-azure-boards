// live-test/abilities/index.ts
import { Ability } from "../types";
import { deleteTagAbility } from "./deleteTag";
import { listTagsAndCountsAbility } from "./listTagsAndCounts";
import { mergeTagsAbility } from "./mergeTags";
import { pagingVolumeAbility } from "./pagingVolume";
import { renameTagAbility } from "./renameTag";

export const ALL_ABILITIES: Ability[] = [
  listTagsAndCountsAbility,
  renameTagAbility,
  mergeTagsAbility,
  deleteTagAbility,
  pagingVolumeAbility,
];
