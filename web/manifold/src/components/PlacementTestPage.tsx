import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { getOrderingIntroIdx, getPlacementTest, QuizEngineState, setOrderingIntroIdx } from "../quizEngine";

import './PlacementTestPage.css';

const PlacementTestPage: React.FC<{quizEngineState: QuizEngineState}> = ({quizEngineState}) => {
  const navigate = useNavigate();
  const [test, setTest] = useState(() => getPlacementTest());
  const [selGroup, setSetGroup] = useState<number | null>(() => {
    const introIdx = getOrderingIntroIdx(quizEngineState);
    if (introIdx === null) {
      return null;
    } else {
      let gidx = 0;
      for (const g of test) {
        if (introIdx === g.beginIndex) {
          return gidx;
        }
        gidx++;
      }
      return null;
    }
  });

  return (
    <div className="PlacementTestPage">
      <div>
        <strong>Choose a level to start learning from</strong><br/>
        Manifold uses an ordered list of words to prioritize what it teaches you. Shown below are random sets of words, each drawn from a different range of that ordering. We recommend choosing the <em>highest level where there are more than 1 or 2 words you don't know</em>. This is the level at which around which Manifold will start suggesting words for you to study. And don't worry: 1) you can change this setting later 2) you can easily skip studying any words you already know 3) if there are words below that level you don't know, you will have a chance to fill in those gaps as well.<br />
        <strong>Note:</strong> Words are currently shown in their most kanji-ified forms, which makes easy words hard to recognize (e.g. この is shown as 此の, する is shown as 為る). This will be fixed soon.
      </div>
      <div><button onClick={() => {setTest(getPlacementTest())}}>Repick Words</button></div>
      {test.map((group, gidx) => (
        <div key={gidx} className="PlacementTestPage-group">
          <input type="radio" name="placement-test-group" id={`placement-test-group-${gidx}`} checked={gidx === selGroup} onChange={() => {console.log('chose placement group', group); setSetGroup(gidx)}} />
          <label htmlFor={`placement-test-group-${gidx}`}>
            <span className="PlacementTestPage-group-level">[Level {gidx+1}]</span> {group.words.map((word, widx) => <span key={widx} className="PlacementTestPage-words">{word}</span>)}
          </label>
        </div>
      ))}
      <div><button className="App-chonky-button" disabled={selGroup === null} onClick={() => {
        const index = test[selGroup!].beginIndex;
        setOrderingIntroIdx(quizEngineState, index);
        navigate('/quiz');
      }}>Set Level</button></div>
    </div>
  );
}

export default PlacementTestPage;
