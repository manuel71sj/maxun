import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MainMenu } from "../components/organisms/MainMenu";
import { Stack } from "@mui/material";
import { Recordings } from "../components/organisms/Recordings";
import { Runs } from "../components/organisms/Runs";
import ProxyForm from '../components/organisms/ProxyForm';
import ApiKey from '../components/organisms/ApiKey';
import { useGlobalInfoStore } from "../context/globalInfo";
import { createRunForStoredRecording, interpretStoredRecording, notifyAboutAbort, scheduleStoredRecording } from "../api/storage";
import { io, Socket } from "socket.io-client";
import { stopRecording } from "../api/recording";
import { RunSettings } from "../components/molecules/RunSettings";
import { ScheduleSettings } from "../components/molecules/ScheduleSettings";
import { IntegrationSettings } from "../components/molecules/IntegrationSettings";
import { RobotSettings } from "../components/molecules/RobotSettings";
import { apiUrl } from "../apiConfig";

interface MainPageProps {
  handleEditRecording: (id: string, fileName: string) => void;
}

export interface CreateRunResponse {
  browserId: string;
  runId: string;
}

export interface ScheduleRunResponse {
  message: string;
  runId: string;
}

export const MainPage = ({ handleEditRecording }: MainPageProps) => {
  const { t } = useTranslation();
  const [content, setContent] = React.useState('recordings');
  const [sockets, setSockets] = React.useState<Socket[]>([]);
  const [runningRecordingId, setRunningRecordingId] = React.useState('');
  const [runningRecordingName, setRunningRecordingName] = React.useState('');
  const [currentInterpretationLog, setCurrentInterpretationLog] = React.useState('');
  const [ids, setIds] = React.useState<CreateRunResponse>({
    browserId: '',
    runId: ''
  });

  let aborted = false;

  const { notify, setRerenderRuns, setRecordingId } = useGlobalInfoStore();

  const abortRunHandler = (runId: string) => {
    aborted = true;
    notifyAboutAbort(runId).then(async (response) => {
      if (response) {
        notify('success', t('main_page.notifications.abort_success', { name: runningRecordingName }));
        await stopRecording(ids.browserId);
      } else {
        notify('error', t('main_page.notifications.abort_failed', { name: runningRecordingName }));
      }
    })
  }

  const setRecordingInfo = (id: string, name: string) => {
    setRunningRecordingId(id);
    setRecordingId(id);
    setRunningRecordingName(name);
  }

  const readyForRunHandler = useCallback((browserId: string, runId: string) => {
    interpretStoredRecording(runId).then(async (interpretation: boolean) => {
      if (!aborted) {
        if (interpretation) {
          notify('success', t('main_page.notifications.interpretation_success', { name: runningRecordingName }));
        } else {
          notify('success', t('main_page.notifications.interpretation_failed', { name: runningRecordingName }));
          // destroy the created browser
          await stopRecording(browserId);
        }
      }
      setRunningRecordingName('');
      setCurrentInterpretationLog('');
      setRerenderRuns(true);
    })
  }, [runningRecordingName, aborted, currentInterpretationLog, notify, setRerenderRuns]);

  const debugMessageHandler = useCallback((msg: string) => {
    setCurrentInterpretationLog((prevState) =>
      prevState + '\n' + `[${new Date().toLocaleString()}] ` + msg);
  }, [currentInterpretationLog])

  const handleRunRecording = useCallback((settings: RunSettings) => {
    createRunForStoredRecording(runningRecordingId, settings).then(({ browserId, runId }: CreateRunResponse) => {
      setIds({ browserId, runId });
      const socket =
        io(`${apiUrl}/${browserId}`, {
          transports: ["websocket"],
          rejectUnauthorized: false
        });
      setSockets(sockets => [...sockets, socket]);
      socket.on('ready-for-run', () => readyForRunHandler(browserId, runId));
      socket.on('debugMessage', debugMessageHandler);
      setContent('runs');
      if (browserId) {
        notify('info', t('main_page.notifications.run_started', { name: runningRecordingName }));
      } else {
        notify('error', t('main_page.notifications.run_start_failed', { name: runningRecordingName }));
      }
    })
    return (socket: Socket, browserId: string, runId: string) => {
      socket.off('ready-for-run', () => readyForRunHandler(browserId, runId));
      socket.off('debugMessage', debugMessageHandler);
    }
  }, [runningRecordingName, sockets, ids, readyForRunHandler, debugMessageHandler])

  const handleScheduleRecording = (settings: ScheduleSettings) => {
    scheduleStoredRecording(runningRecordingId, settings)
      .then(({ message, runId }: ScheduleRunResponse) => {
        if (message === 'success') {
          notify('success', t('main_page.notifications.schedule_success', { name: runningRecordingName }));
        } else {
          notify('error', t('main_page.notifications.schedule_failed', { name: runningRecordingName }));
        }
      });
  }

  const DisplayContent = () => {
    switch (content) {
      case 'recordings':
        return <Recordings
          handleEditRecording={handleEditRecording}
          handleRunRecording={handleRunRecording}
          setRecordingInfo={setRecordingInfo}
          handleScheduleRecording={handleScheduleRecording}
        />;
      case 'runs':
        return <Runs
          currentInterpretationLog={currentInterpretationLog}
          abortRunHandler={() => abortRunHandler(ids.runId)}
          runId={ids.runId}
          runningRecordingName={runningRecordingName}
        />;
      case 'proxy':
        return <ProxyForm />;
      case 'apikey':
        return <ApiKey />;
      default:
        return null;
    }
  }

  return (
    <Stack direction='row' spacing={0} sx={{ minHeight: '900px' }}>
      <MainMenu value={content} handleChangeContent={setContent} />
      {DisplayContent()}
    </Stack>
  );
};