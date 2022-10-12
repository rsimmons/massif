import { Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';

import { SRSAnalysis } from '../quizEngine';
import { humanTime, invariant } from '../util';
import './Header.css';

const Header: React.FC<{srsAn: SRSAnalysis}> = ({srsAn}) => {
  const dueCount = srsAn.dueWords.length;
  const dueSoonCount = srsAn.dueSoonWords.length;
  const queuedCount = srsAn.queuedWords.length;

  return (
    <div className="Header">
      <div>
        <div>
          {(() => {
            if (dueCount > 0) {
              return <>{dueCount} due now{(dueSoonCount > 0) && <>, {dueSoonCount} due soon</> }</>
            } else if (dueSoonCount > 0) {
              invariant(srsAn.timeUntilNextLearningDue !== undefined);
              return <>{dueSoonCount} due soon, {humanTime(srsAn.timeUntilNextLearningDue)} until next</>
            } else {
              return <>nothing for review today</>
            }
          })()}
        </div>
        <div>
          {srsAn.todayIntroCount}/{srsAn.todayIntroLimit} daily intros done
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
