import React, { useEffect, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { Routes, Route, useNavigate } from 'react-router-dom';

import { initState, needPlacementTest, QuizEngineState } from '../quizEngine';
import Header from './Header';
import PlacementTestPage from './PlacementTestPage';
import QuizPage from './QuizPage';
import SettingsPage from './SettingsPage';
import './App.css';

const HomePage: React.FC<{quizEngineState: QuizEngineState, time: Dayjs}> = ({quizEngineState, time}) => {
  const navigate = useNavigate();

  return (
    <>
      <Header quizEngineState={quizEngineState} time={time}/>
      <div className="HomePage-main">
        <button className="App-chonky-button" onClick={() => {
          if (needPlacementTest(quizEngineState)) {
            navigate('/placement');
          } else {
            navigate('/quiz');
          }
        }}>Study</button>
      </div>
    </>
  );
}

// Expose the quiz engine state as a global variable for messing around in the console
declare global {
  var quizEngineState: QuizEngineState;
}

const App: React.FC = () => {
  const [quizEngineState, setQuizEngineState] = useState<QuizEngineState | undefined>();
  const time = dayjs();

  useEffect(() => {
    (async () => {
      // TODO: handle errors loading here
      const qes = await initState({}, dayjs());
      setQuizEngineState(qes);
      globalThis.quizEngineState = qes;
    })();
  }, []);

  if (!quizEngineState) {
    return <div>loading...</div>;
  }

  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<HomePage quizEngineState={quizEngineState} time={time} />} />
        <Route path="/placement" element={<PlacementTestPage quizEngineState={quizEngineState} />} />
        <Route path="/quiz" element={<QuizPage quizEngineState={quizEngineState} time={time} />} />
        <Route path="/settings" element={<SettingsPage quizEngineState={quizEngineState} />} />
      </Routes>
    </div>
  );
}

export default App;
