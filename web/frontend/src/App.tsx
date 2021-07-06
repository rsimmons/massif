import React, {useReducer} from 'react';
import {reducer, INITIAL_STATE} from './State';
import './App.css';

function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const updateSuggestion = (): void => {
  };

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

      const rawResponse = await fetch('http://localhost:5000/api/get_text_normal_counts', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'text': knownText,
        }),
      });

      if (!rawResponse.ok) {
        throw new Error(); // TODO: handle
      }

      const content = await rawResponse.json();

      dispatch({tag: 'log_status', status: 'Done analyzing.'});

      // content is a map from normal to count, so we just get the normals
      const normals: Array<string> = [];
      for (const [key, ] of Object.entries(content)) {
        normals.push(key);
      }

      dispatch({tag: 'add_known_normals', normals});

      updateSuggestion();
    })();
  };

  const onKnownTextFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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

  return (
    <div className="App">
      <input type="file" id="known-text-file" onChange={onKnownTextFileChange} />
      <div>Known count: {state.knownNormals.size}</div>
      <div>{state.statusLog.map(entry => (<React.Fragment key={entry}>{entry}<br/></React.Fragment>))}</div>
    </div>
  );
}

export default App;
