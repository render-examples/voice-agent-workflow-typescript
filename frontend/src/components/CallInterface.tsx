import { useState, useEffect, useCallback } from 'react';
import {
  LiveKitRoom,
  useVoiceAssistant,
  BarVisualizer,
  RoomAudioRenderer,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { getToken, getSession, type CallSession } from '../lib/api';
import { Phone, PhoneOff, Mic, MicOff, CheckCircle2, Loader2, User, MapPin, Car, Hash, Users, Shield, Info } from 'lucide-react';

interface CallInterfaceProps {
  onCallEnd: () => void;
}

interface TranscriptEntry {
  role: 'agent' | 'user';
  text: string;
  id: string;
}

const FIELD_CONFIG: Record<string, { label: string; icon: React.ElementType }> = {
  safety_confirmed: { label: 'Safety Confirmed', icon: Shield },
  phone: { label: 'Phone Number', icon: Phone },
  location: { label: 'Accident Location', icon: MapPin },
  damage: { label: 'Damage Description', icon: Car },
  zip: { label: 'ZIP Code', icon: Hash },
  other_party: { label: 'Other Parties', icon: Users },
};

const TASK_LABELS: Record<string, string> = {
  verify_policy: 'Verifying Policy',
  analyze_damage: 'Analyzing Damage',
  fraud_check: 'Security Check',
  find_shops: 'Finding Repair Shops',
};

function ActiveCall({ onCallEnd, roomName }: { onCallEnd: () => void; roomName: string }) {
  const { state, audioTrack } = useVoiceAssistant();
  const room = useRoomContext();
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [session, setSession] = useState<CallSession>({ collected: {}, tasks: {} });

  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchSession = async () => {
      const data = await getSession(roomName);
      setSession(data);
    };
    fetchSession();
    const interval = setInterval(fetchSession, 1000);
    return () => clearInterval(interval);
  }, [roomName]);

  useEffect(() => {
    if (!room) return;

    const handleTranscription = (segments: any[], participant: any) => {
      segments.forEach((segment) => {
        if (segment.final && segment.text) {
          const isAgent = participant?.identity?.includes('agent');
          setTranscript((prev) => {
            const exists = prev.some((t) => t.id === segment.id);
            if (exists) return prev;
            return [
              ...prev,
              {
                role: isAgent ? 'agent' : 'user',
                text: segment.text,
                id: segment.id || `${Date.now()}`,
              },
            ];
          });
        }
      });
    };

    room.on('transcriptionReceived', handleTranscription);
    return () => {
      room.off('transcriptionReceived', handleTranscription);
    };
  }, [room]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = useCallback(async () => {
    await room.disconnect();
    onCallEnd();
  }, [room, onCallEnd]);

  const toggleMute = () => {
    room.localParticipant.setMicrophoneEnabled(isMuted);
    setIsMuted(!isMuted);
  };

  const collectedFields = Object.entries(session.collected);
  const runningTasks = Object.entries(session.tasks);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
      {/* Main Call Card */}
      <div className="lg:col-span-2">
        <div className="bg-neutral-50 border border-neutral-200 p-8">
          {/* Agent Status */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 text-sm font-medium mb-4">
              <span className="w-2 h-2 bg-emerald-500 animate-pulse" />
              {state === 'speaking' ? 'Agent Speaking' : state === 'listening' ? 'Listening' : 'Connected'}
            </div>
            
            <h2 className="text-2xl font-semibold mb-1 text-neutral-900">Alex</h2>
            <p className="text-neutral-500">SafeDrive Insurance Agent</p>
          </div>

          {/* Audio Visualizer */}
          <div className="h-24 mb-6 flex items-center justify-center">
            {audioTrack ? (
              <BarVisualizer
                state={state}
                barCount={5}
                trackRef={audioTrack}
                className="h-full"
                options={{ minHeight: 20 }}
              />
            ) : (
              <div className="flex items-end gap-1 h-16">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-3 bg-blue-600 audio-bar" style={{ height: '100%' }} />
                ))}
              </div>
            )}
          </div>

          {/* Call Duration */}
          <div className="text-center mb-6">
            <span className="font-mono text-3xl text-neutral-900">{formatDuration(callDuration)}</span>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleMute}
              className={`p-4 transition-colors ${
                isMuted ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
              }`}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            
            <button
              onClick={handleEndCall}
              className="p-5 bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </div>
        </div>

        {/* Transcript Preview */}
        <div className="mt-4 p-4 bg-neutral-50 border border-neutral-200">
          <h3 className="text-sm font-medium text-neutral-500 mb-2">Live Transcript</h3>
          <div className="text-sm text-neutral-700 space-y-2 max-h-32 overflow-y-auto">
            {transcript.length === 0 ? (
              <p className="text-neutral-400 italic">Transcript will appear here...</p>
            ) : (
              transcript.map((t) => (
                <p key={t.id}>
                  <span className={t.role === 'agent' ? 'text-blue-600 font-medium' : 'text-emerald-600 font-medium'}>
                    {t.role === 'agent' ? 'Alex: ' : 'You: '}
                  </span>
                  {t.text}
                </p>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right Sidebar - Collected Data & Tasks */}
      <div className="space-y-4">
        {/* Collected Information */}
        <div className="bg-neutral-50 border border-neutral-200 p-4">
          <h3 className="text-sm font-medium text-neutral-500 mb-3 flex items-center gap-2">
            <User className="w-4 h-4" />
            Collected Information
          </h3>
          <div className="space-y-2">
            {collectedFields.length === 0 ? (
              <p className="text-neutral-400 text-sm italic">Data will appear as you speak...</p>
            ) : (
              collectedFields.map(([field, value]) => {
                const config = FIELD_CONFIG[field] || { label: field, icon: CheckCircle2 };
                const Icon = config.icon;
                return (
                  <div key={field} className="flex items-start gap-2 p-2 bg-white border border-neutral-200">
                    <Icon className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-500">{config.label}</div>
                      <div className="text-sm text-neutral-900 truncate">{value}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Background Tasks */}
        <div className="bg-neutral-50 border border-neutral-200 p-4">
          <h3 className="text-sm font-medium text-neutral-500 mb-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4" />
            Background Tasks
          </h3>
          <div className="space-y-2">
            {runningTasks.length === 0 ? (
              <p className="text-neutral-400 text-sm italic">Tasks will start automatically...</p>
            ) : (
              runningTasks.map(([taskName, task]) => (
                <div key={taskName} className="flex items-center gap-2 p-2 bg-white border border-neutral-200">
                  {task.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-neutral-900">{TASK_LABELS[taskName] || taskName}</div>
                    {task.status === 'completed' && Boolean(task.result) && (
                      <div className="text-xs mt-0.5">
                        {taskName === 'verify_policy' && (
                          <span className={(task.result as any).status === 'active' ? 'text-emerald-600' : 'text-amber-600'}>
                            {(task.result as any).name} • {(task.result as any).loyalty_tier}
                            {(task.result as any).previous_claims > 0 && ` • ${(task.result as any).previous_claims} prior claims`}
                          </span>
                        )}
                        {taskName === 'analyze_damage' && (
                          <span className={
                            (task.result as any).severity === 'minor' ? 'text-emerald-600' :
                            (task.result as any).severity === 'moderate' ? 'text-amber-600' : 'text-red-600'
                          }>
                            {(task.result as any).severity} • {(task.result as any).parts?.length} parts
                          </span>
                        )}
                        {taskName === 'fraud_check' && (
                          <span className={(task.result as any).passed ? 'text-emerald-600' : 'text-amber-600'}>
                            {(task.result as any).passed ? 'Passed' : 'Review needed'} • Risk: {Math.round((task.result as any).risk_score * 100)}%
                          </span>
                        )}
                        {taskName === 'find_shops' && (
                          <span className="text-emerald-600">
                            Found {Array.isArray(task.result) ? task.result.length : (task.result as any).shops?.length} shops
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {task.status === 'completed' ? (
                    <span className="text-xs text-emerald-600">Done</span>
                  ) : (
                    <span className="text-xs text-blue-600">Running</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Demo Scenarios */}
        <div className="bg-neutral-50 border border-neutral-200 p-4">
          <h3 className="text-sm font-medium text-neutral-500 mb-3 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Demo Profiles
          </h3>
          <div className="space-y-2 text-xs">
            <div className="p-2 bg-white border border-neutral-200">
              <div className="flex justify-between font-mono">
                <span className="text-emerald-600">555-0100</span>
                <span className="text-neutral-400">94102</span>
              </div>
              <div className="text-neutral-700">Sarah — Toyota Camry</div>
            </div>
            <div className="p-2 bg-white border border-neutral-200">
              <div className="flex justify-between font-mono">
                <span className="text-amber-600">555-0200</span>
                <span className="text-neutral-400">90210</span>
              </div>
              <div className="text-neutral-700">Mike — Ford F-150</div>
            </div>
            <div className="p-2 bg-white border border-neutral-200">
              <div className="flex justify-between font-mono">
                <span className="text-violet-600">555-0300</span>
                <span className="text-neutral-400">10001</span>
              </div>
              <div className="text-neutral-700">Emma — BMW X5 (VIP)</div>
            </div>
            <div className="p-2 bg-white border border-neutral-200">
              <div className="flex justify-between font-mono">
                <span className="text-red-600">555-0400</span>
                <span className="text-neutral-400">33101</span>
              </div>
              <div className="text-neutral-700">James — Honda Civic</div>
            </div>
          </div>
        </div>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

export default function CallInterface({ onCallEnd }: CallInterfaceProps) {
  const [connectionDetails, setConnectionDetails] = useState<{
    token: string;
    serverUrl: string;
    roomName: string;
  } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCall = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      const data = await getToken();
      setConnectionDetails({
        token: data.token,
        serverUrl: data.livekit_url,
        roomName: data.room_name,
      });
    } catch (err) {
      setError('Failed to connect. Please check your configuration.');
      console.error(err);
    } finally {
      setIsConnecting(false);
    }
  };

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center">
        <div className="p-6 bg-red-50 border border-red-200">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={startCall}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (isConnecting) {
    return (
      <div className="max-w-md mx-auto text-center">
        <div className="p-8 bg-neutral-50 border border-neutral-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 flex items-center justify-center">
            <Phone className="w-8 h-8 text-blue-600 animate-pulse" />
          </div>
          <h2 className="text-xl font-semibold mb-2 text-neutral-900">Connecting...</h2>
          <p className="text-neutral-500">Setting up your call with our AI agent</p>
        </div>
      </div>
    );
  }

  if (!connectionDetails) {
    return (
      <div className="max-w-md mx-auto text-center">
        <div className="p-8 bg-neutral-50 border border-neutral-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 flex items-center justify-center">
            <Phone className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2 text-neutral-900">Ready to Call</h2>
          <p className="text-neutral-500 mb-6">Click below to start your call with Alex, our AI insurance agent</p>
          <button
            onClick={startCall}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors flex items-center gap-2 mx-auto"
          >
            <Phone className="w-5 h-5" />
            Start Call
          </button>
          <p className="text-xs text-neutral-400 mt-4">Make sure to allow microphone access when prompted</p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={connectionDetails.token}
      serverUrl={connectionDetails.serverUrl}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={() => console.log('Disconnected')}
    >
      <ActiveCall onCallEnd={onCallEnd} roomName={connectionDetails.roomName} />
    </LiveKitRoom>
  );
}
