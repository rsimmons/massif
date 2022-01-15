import React, {useEffect, Fragment, ReactNode, useMemo} from 'react';
import {reducer, INITIAL_STATE, SavingFragmentState} from './State';
import './App.css';
import { useEffectfulReducer } from './useEffectfulReducer';

// Globals set by Flask in index.html
declare const MASSIF_URL_API_GET_TEXT_NORMAL_COUNTS: string;

const SavingFragmentForm: React.FC<{frag: SavingFragmentState, onUpdate(frag: SavingFragmentState): void, onSave(): void, onCancel(): void}> = ({frag, onUpdate, onSave, onCancel}) => {
  return (
    <p style={{background: '#ddd'}}>
      Saving fragment:<br/>
      <input type="text" value={frag.text} size={100} onInput={(e) => { onUpdate({...frag, text: e.currentTarget.value}); }} /><br/>
      <input type="text" value={frag.reading} size={100} onInput={(e) => { onUpdate({...frag, reading: e.currentTarget.value}); }} /><br/>
      <textarea value={frag.notes} rows={10} cols={100} onInput={(e) => { onUpdate({...frag, notes: e.currentTarget.value}); }} /><br/>
      <button onClick={onSave}>Save</button> <button onClick={onCancel}>Cancel</button>
    </p>
  );
}

function newline2br(text: string): ReactNode {
  return text.split('\n').map((item, idx) => {
    return <Fragment key={idx}>{item}<br/></Fragment>
  });
}

function downloadTextFile(filename: string, text: string) {
  const elem = document.createElement('a');

  elem.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  elem.setAttribute('download', filename);
  elem.style.display = 'none';

  document.body.appendChild(elem);

  elem.click();

  document.body.removeChild(elem);
}

function escapeFieldForAnki(s: string): string {
  // per Anki manual
  return '"' + s.replaceAll('"', '""') + '"';
}

const App: React.FC = () => {
  const [state, dispatch] = useEffectfulReducer(reducer, INITIAL_STATE);

  // Initialize once upon mount
  useEffect(() => {
    dispatch({tag: 'init'});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savedFragmentTexts = useMemo(() => new Set(state.savedFragments.map(frag => frag.text)), [state.savedFragments])

  const analyzeKnownText = (text: string): void => {
    const sentences: Array<string> = [];

    for (const line of text.split('\n')) {
      const fields = line.split('\t');
      sentences.push(fields[0]);
    }

    const knownText = sentences.join('\n');

    // TODO: feed in this URL from Flask?
    (async () => {
      const response = await fetch(MASSIF_URL_API_GET_TEXT_NORMAL_COUNTS, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'text': knownText,
        }),
      });

      if (!response.ok) {
        throw new Error(); // TODO: handle
      }

      const content = await response.json();

      // content is a map from normal to count, so we just get the normals
      const normals: Array<string> = [];
      for (const [key, ] of Object.entries(content)) {
        normals.push(key);
      }

      dispatch({tag: 'add_known_normals', normals});
    })();
  };

  const handleKnownTextFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if ((files !== null) && (files.length > 0)) {
      const file = files[0];

      const reader = new FileReader();
      reader.readAsText(file);
      reader.onload = () => {
        if (typeof(reader.result) !== 'string') {
          throw new Error();
        }
        analyzeKnownText(reader.result);
      };
      reader.onerror = () => {
        // TODO: handle
      };
    }
  };

  const handleKnowSuggestedNormalClick = () => {
    if (state.suggestedNormal === null) {
      throw new Error();
    }
    dispatch({tag: 'add_known_normals', normals: [state.suggestedNormal]});
  }

  const handleExportSavedFragmentsClick = () => {
    const tags = 'pathfinder';
    const text = state.savedFragments.map(frag => `${escapeFieldForAnki(frag.text)}\t${escapeFieldForAnki(frag.reading)}\t${escapeFieldForAnki(frag.notes)}\t${tags}\n`).join('');
    const datetimeStr = (new Date()).toISOString().replace('Z', '').replaceAll(':', '-').substr(0, 19);
    const fn = `pathfinder-${datetimeStr}.tsv`;
    downloadTextFile(fn, text);
  }

  return (
    <div className="App">
      {state.loading ? (
        <div>Loading...</div>
      ) : (
        <div className="App-columns">
          <div>
            <p><input type="file" id="known-text-file" onChange={handleKnownTextFileChange} /></p>
            <p>Known count: {state.knownNormals.size}</p>
            <p>Suggested normal: {state.suggestedNormal} {(state.suggestedNormal !== null) && <button onClick={handleKnowSuggestedNormalClick}>I know this</button>}</p>
            <p>{state.statusLog.map((entry, idx) => (<React.Fragment key={idx}>{entry}<br/></React.Fragment>))}</p>
            {state.savingFragment &&
              <SavingFragmentForm
                frag={state.savingFragment}
                onUpdate={(frag) => { dispatch({tag: 'update_saving_fragment', fragment: frag}); }}
                onSave={() => { dispatch({tag: 'finish_saving_fragment'}); }}
                onCancel={() => {}}
              />
            }
          </div>
          <div>
            <p>Suggested fragments:</p>
            <ul>{(state.suggestedFragments !== 'fetching') && state.suggestedFragments?.map((frag, idx) => {
              return <li key={idx}>{frag.text} <button onClick={() => { dispatch({tag: 'begin_saving_fragment', fragment: frag}); }} disabled={savedFragmentTexts.has(frag.text)}>+</button><br/>{frag.reading}</li>;
            })}</ul>
          </div>
          <div>
            <p>Saved fragments [{state.savedFragments.length}]: <button onClick={handleExportSavedFragmentsClick}>Export</button></p>
            <ul>{state.savedFragments.map((frag) => {
              return (
                <li key={frag.uid}>
                  {frag.text}<br/>
                  {frag.reading}<br/>
                  {newline2br(frag.notes)}<br/>
                  <button onClick={() => { dispatch({tag: 'delete_saved_fragment', fragmentId: frag.uid}); }}>X</button>
                </li>
              );
            })}</ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
