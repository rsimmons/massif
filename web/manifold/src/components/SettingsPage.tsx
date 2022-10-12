import { Link } from 'react-router-dom';
import dayjs from 'dayjs';

import { QuizEngineState } from '../quizEngine';
import { exportBackup } from '../storage';
import './SettingsPage.css';

const SettingsPage: React.FC<{quizEngineState: QuizEngineState}> = ({quizEngineState}) => {
  return (
    <div className="SettingsPage">
      <div>
        <button onClick={() => {
          (async () => {
            const blobURL = URL.createObjectURL(await exportBackup());
            const anchor = document.createElement('a');
            anchor.href = blobURL;
            anchor.download = `manifold-backup-${dayjs().format('YYYY-MM-DD-HH-mm-ss')}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
          })();
        }}>Download Backup</button>
      </div>
      <div>
        Redo <Link to="/placement">placement test</Link>
      </div>
    </div>
  );
}

export default SettingsPage;
