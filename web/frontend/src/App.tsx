import React, {useEffect, useReducer} from 'react';
import {reducer, INITIAL_STATE} from './State';
import './App.css';

function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    if (state.suggestedNormal && (state.suggestedFragments === null)) {
      // need to fetch fragments for suggestedNormal
      dispatch({tag: 'log_status', status: 'Fetching fragments...'});

      dispatch({tag: 'set_suggested_fragments', fragments: 'fetching'});

      (async () => {
        const response = await fetch('http://localhost:5000/api/get_normal_fragments', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            'normal': state.suggestedNormal,
          }),
        });

        if (!response.ok) {
          throw new Error(); // TODO: handle
        }

        const content = await response.json();

        // NOTE: We don't validate that is has the right types

        dispatch({tag: 'set_suggested_fragments', fragments: content});
      })();

      dispatch({tag: 'log_status', status: 'Fragments updated.'});
    }
  });

  const analyzeKnownText = (text: string): void => {
    const sentences: Array<string> = [];

    for (const line of text.split('\n')) {
      const fields = line.split('\t');
      sentences.push(fields[0]);
    }

    const knownText = sentences.join('\n');

    // TODO: feed in this URL from Flask?
    (async () => {
      dispatch({tag: 'log_status', status: 'Analyzing...'});

      const response = await fetch('http://localhost:5000/api/get_text_normal_counts', {
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

      dispatch({tag: 'log_status', status: 'Done analyzing.'});

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

  return (
    <div className="App">
      <p><input type="file" id="known-text-file" onChange={handleKnownTextFileChange} /></p>
      <p>Known count: {state.knownNormals.size}</p>
      <p>Suggested normal: {state.suggestedNormal} {(state.suggestedNormal !== null) && <button onClick={handleKnowSuggestedNormalClick}>I know this</button>}</p>
      <div>
        <p>Suggested fragments:</p>
        <ul>{(typeof(state.suggestedFragments) === 'object') && state.suggestedFragments?.map((frag, idx) => {
          return <li key={idx}>{frag.text}<br/>{frag.reading}</li>;
        })}</ul>
      </div>
      <p>{state.statusLog.map((entry, idx) => (<React.Fragment key={idx}>{entry}<br/></React.Fragment>))}</p>
    </div>
  );
}

export default App;
