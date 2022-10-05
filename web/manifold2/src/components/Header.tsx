import { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';

import { getSRSAnalysis, getSRSIntroStats, QuizEngineState } from '../quizEngine';
import { humanTime, invariant } from '../util';
import './Header.css';

const Header: React.FC<{quizEngineState: QuizEngineState, time: Dayjs}> = ({quizEngineState, time}) => {
  const srsAn = getSRSAnalysis(quizEngineState, time);
  const introStats = getSRSIntroStats(quizEngineState);

  const dueCount = srsAn.dueWords.length;
  const dueSoonCount = srsAn.dueSoonWords.length;
  const timeUntilNextLearningDue = (srsAn.dueSoonWords.length > 0) ? (srsAn.dueSoonWords[0].nextTime - time.unix()) : undefined;
  const queuedCount = srsAn.queuedWords.length;

  return (
    <div className="Header">
      <div>
        <div>
          {(() => {
            if (dueCount > 0) {
              return <>{dueCount} due now{(dueSoonCount > 0) && <>, {dueSoonCount} due soon</> }</>
            } else if (dueSoonCount > 0) {
              invariant(timeUntilNextLearningDue !== undefined);
              return <>{dueSoonCount} due soon, {humanTime(timeUntilNextLearningDue)} until next</>
            } else {
              return <>nothing for review today</>
            }
          })()}
        </div>
        <div>
          {introStats.todayIntroCount}/{introStats.todayIntroLimit} daily intros done
        </div>
        <div>
          {queuedCount} in queue
        </div>
      </div>
      <div className="Header-right">
        <Link to="/settings">Settings</Link>
      </div>
    </div>
  );
}

export default Header;
