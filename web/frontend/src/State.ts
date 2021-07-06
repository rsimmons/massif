export interface State {
  readonly statusLog: ReadonlyArray<string>;
  readonly knownNormals: Set<string>;
  readonly suggestedNormal: string | null;
  readonly suggestedFragments: ReadonlyArray<string> | null;
}

export interface LogStatusAction {
  readonly tag: 'log_status';
  readonly status: string;
}

export interface AddKnownNormalsAction {
  readonly tag: 'add_known_normals';
  readonly normals: ReadonlyArray<string>;
}

type Action = LogStatusAction | AddKnownNormalsAction;

export function reducer(s: State, a: Action): State {
  switch (a.tag) {
    case 'log_status':
      return {
        ...s,
        statusLog: s.statusLog.concat([a.status]),
      };

    case 'add_known_normals':
      return {
        ...s,
        knownNormals: new Set([...s.knownNormals, ...a.normals]),
      };
  }
}

export const INITIAL_STATE: State = {
  statusLog: [],
  knownNormals: new Set(),
  suggestedNormal: null,
  suggestedFragments: null,
};
