import { SavedFragment } from "./State";

const PROFILE_STORAGE_KEY = 'massif_pathfinder_v1';

export interface Profile {
  readonly knownNormals: ReadonlySet<string>;
  readonly savedFragments: ReadonlyArray<SavedFragment>;
}

export function loadProfile(): Profile | null {
  const storedStr = localStorage.getItem(PROFILE_STORAGE_KEY);
  if (storedStr === null) {
    return null;
  }

  const storedObj = JSON.parse(storedStr);

  // NOTE: We do no validation of the contents, even the types

  return {
    knownNormals: new Set(storedObj.knownNormals),
    savedFragments: storedObj.savedFragments,
  };
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
    knownNormals: [...profile.knownNormals],
    savedFragments: profile.savedFragments,
  }));
}
