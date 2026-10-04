import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { socket } from '../../lib/socket'

type CallState = {
  callId: string
  chatId: string
  peerId: string
  peerName: string
  role: 'caller' | 'callee'
  status: 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended'
  message?: string
}
type CallContextValue = {
  call: CallState | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  startCall: (chatId: string, peerName: string) => void
  acceptCall: () => void
  declineCall: () => void
  endCall: () => void
  toggleAudio: () => void
  toggleVideo: () => void
  audioEnabled: boolean
  videoEnabled: boolean
  busyMessage: string
}
const CallContext = createContext<CallContextValue | null>(null)
const defaultIceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

async function acquireCallMedia(callId: string) {
  const videoConstraints = (deviceId?: string): MediaTrackConstraints => ({
    width: { ideal: 640 },
    height: { ideal: 480 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  })
  const describeError = (error: unknown) => ({
    name:
      error instanceof DOMException
        ? error.name
        : error instanceof Error
          ? error.constructor.name
          : 'UnknownError',
    message: error instanceof Error ? error.message : 'Camera could not start',
  })

  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoConstraints(),
      }),
      audioOnly: false,
      cameraFailure: undefined,
    }
  } catch (initialError) {
    let cameraFailure = describeError(initialError).message
    console.warn('[call] default camera failed; trying available cameras', {
      callId,
      error: cameraFailure,
      errorName: describeError(initialError).name,
    })

    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const cameras = devices.filter((device) => device.kind === 'videoinput' && device.deviceId)
    for (let index = 0; index < cameras.length; index += 1) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: videoConstraints(cameras[index].deviceId),
        })
        console.info('[call] camera retry succeeded', { callId, attempt: index + 1 })
        return { stream, audioOnly: false, cameraFailure: undefined }
      } catch (cameraError) {
        const details = describeError(cameraError)
        cameraFailure = details.message
        console.warn('[call] camera retry failed', {
          callId,
          attempt: index + 1,
          error: cameraFailure,
          errorName: details.name,
        })
      }
    }

    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      audioOnly: true,
      cameraFailure,
    }
  }
}

export function VideoCallProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<CallState | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [busyMessage, setBusyMessage] = useState('')
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const connectionDropTimer = useRef<number | null>(null)
  const iceRestartAttempts = useRef(0)
  const iceRestartInFlight = useRef(false)
  const hasTurnServer = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingSignals = useRef<
    Array<{ description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }>
  >([])
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const callRef = useRef<CallState | null>(null)
  const pendingInvite = useRef(false)
  useEffect(() => {
    callRef.current = call
  }, [call])

  const releaseMedia = useCallback(() => {
    if (connectionDropTimer.current !== null) window.clearTimeout(connectionDropTimer.current)
    connectionDropTimer.current = null
    iceRestartAttempts.current = 0
    iceRestartInFlight.current = false
    peerRef.current?.close()
    peerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    pendingSignals.current = []
    pendingCandidates.current = []
  }, [])

  const endLocal = useCallback(
    (message?: string) => {
      if (callRef.current?.status === 'ended') return
      console.info('[call] ending locally', {
        callId: callRef.current?.callId,
        role: callRef.current?.role,
        message: message ?? 'Call ended',
      })
      if (callRef.current) callRef.current = { ...callRef.current, status: 'ended', message }
      releaseMedia()
      setCall((current) => (current ? { ...current, status: 'ended', message } : null))
      window.setTimeout(
        () => setCall((current) => (current?.status === 'ended' ? null : current)),
        2600,
      )
    },
    [releaseMedia],
  )

  const applySignal = useCallback(
    async (signal: {
      description?: RTCSessionDescriptionInit
      candidate?: RTCIceCandidateInit
    }) => {
      const peer = peerRef.current
      if (!peer) {
        pendingSignals.current.push(signal)
        return
      }
      try {
        if (signal.description) {
          await peer.setRemoteDescription(signal.description)
          for (const candidate of pendingCandidates.current.splice(0))
            await peer.addIceCandidate(candidate)
          if (signal.description.type === 'offer') {
            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            const current = callRef.current
            if (current)
              socket.emit('call:signal', {
                callId: current.callId,
                description: { type: 'answer', sdp: answer.sdp ?? '' },
              })
          }
        }
        if (signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate)
          else pendingCandidates.current.push(signal.candidate)
        }
      } catch (error) {
        console.warn('[call] signal processing failed', {
          callId: callRef.current?.callId,
          kind: signal.description?.type ?? 'candidate',
          error: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    },
    [],
  )

  const prepareMedia = useCallback(
    async (current: CallState, initiator: boolean) => {
      try {
        const { stream, audioOnly, cameraFailure } = await acquireCallMedia(current.callId)
        const latestCall = callRef.current
        if (!latestCall || latestCall.callId !== current.callId || latestCall.status === 'ended') {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        setLocalStream(stream)
        setCall((value) =>
          value?.callId === current.callId
            ? {
                ...value,
                status: 'connecting',
                message: audioOnly
                  ? `Camera unavailable (${cameraFailure}); continuing with audio only`
                  : undefined,
              }
            : value,
        )
        let iceServers = defaultIceServers
        hasTurnServer.current = false
        await new Promise<void>((resolve) => {
          socket.emit('call:ice-config', (result) => {
            iceServers = result.iceServers
            hasTurnServer.current = result.hasTurnServer
            if (!result.hasTurnServer)
              console.warn('[call] no TURN server configured; some networks may not connect', {
                callId: current.callId,
              })
            resolve()
          })
          window.setTimeout(resolve, 2000)
        })
        const peer = new RTCPeerConnection({ iceServers })
        peerRef.current = peer
        const remote = new MediaStream()
        setRemoteStream(remote)
        peer.ontrack = (event) => {
          const track = event.track
          if (!remote.getTracks().some((existing) => existing.id === track.id))
            remote.addTrack(track)
          console.info('[call] remote track received', {
            callId: current.callId,
            kind: track.kind,
            readyState: track.readyState,
            streamless: event.streams.length === 0,
          })
          setRemoteStream(new MediaStream(remote.getTracks()))
        }
        peer.onicecandidate = (event) => {
          if (event.candidate)
            socket.emit('call:signal', {
              callId: current.callId,
              candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                usernameFragment: event.candidate.usernameFragment,
              },
            })
        }
        peer.oniceconnectionstatechange = () => {
          console.info('[call] ICE state', {
            callId: current.callId,
            state: peer.iceConnectionState,
          })
        }
        peer.onconnectionstatechange = () => {
          console.info('[call] peer connection state', {
            callId: current.callId,
            state: peer.connectionState,
          })
          if (peer.connectionState === 'connected') {
            if (connectionDropTimer.current !== null)
              window.clearTimeout(connectionDropTimer.current)
            connectionDropTimer.current = null
            setCall((value) =>
              value?.callId === current.callId ? { ...value, status: 'active' } : value,
            )
            void peer
              .getStats()
              .then((stats) => {
                const pair = [...stats.values()].find(
                  (item) =>
                    item.type === 'candidate-pair' &&
                    (item as RTCIceCandidatePairStats).state === 'succeeded' &&
                    ((item as RTCIceCandidatePairStats).nominated ||
                      (item as RTCIceCandidatePairStats & { selected?: boolean }).selected),
                ) as RTCIceCandidatePairStats | undefined
                if (!pair) return
                const local = stats.get(pair.localCandidateId) as
                  (RTCStats & { candidateType?: string }) | undefined
                const remote = stats.get(pair.remoteCandidateId) as
                  (RTCStats & { candidateType?: string }) | undefined
                console.info('[call] selected ICE route', {
                  callId: current.callId,
                  localType: local?.candidateType,
                  remoteType: remote?.candidateType,
                })
              })
              .catch(() => undefined)
          }
          if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
            if (connectionDropTimer.current !== null)
              window.clearTimeout(connectionDropTimer.current)
            connectionDropTimer.current = window.setTimeout(() => {
              if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
                console.warn('[call] connection did not recover', {
                  callId: current.callId,
                  state: peer.connectionState,
                })
                socket.emit('call:end', { callId: current.callId })
                endLocal(
                  hasTurnServer.current
                    ? 'Could not establish a relayed connection. Check the TURN credentials and network access.'
                    : 'This deployment has no TURN relay configured. Add managed TURN servers to ICE_SERVERS and try again.',
                )
              }
            }, 20_000)
            if (
              current.role === 'caller' &&
              iceRestartAttempts.current < 2 &&
              !iceRestartInFlight.current
            ) {
              iceRestartAttempts.current += 1
              iceRestartInFlight.current = true
              void (async () => {
                try {
                  peer.restartIce()
                  const offer = await peer.createOffer({ iceRestart: true })
                  await peer.setLocalDescription(offer)
                  socket.emit('call:signal', {
                    callId: current.callId,
                    description: { type: 'offer', sdp: offer.sdp ?? '' },
                  })
                } catch {
                  socket.emit('call:end', { callId: current.callId })
                  endLocal(
                    hasTurnServer.current
                      ? 'Could not establish a relayed connection. Check the TURN credentials and network access.'
                      : 'This deployment has no TURN relay configured. Add managed TURN servers to ICE_SERVERS and try again.',
                  )
                } finally {
                  iceRestartInFlight.current = false
                }
              })()
            }
          }
        }
        stream.getTracks().forEach((track) => peer.addTrack(track, stream))
        const queued = pendingSignals.current.splice(0)
        for (const signal of queued) await applySignal(signal)
        if (initiator) {
          const offer = await peer.createOffer()
          await peer.setLocalDescription(offer)
          socket.emit('call:signal', {
            callId: current.callId,
            description: { type: 'offer', sdp: offer.sdp ?? '' },
          })
        }
      } catch (error) {
        const latestCall = callRef.current
        console.error('[call] media setup failed', {
          callId: current.callId,
          error: error instanceof Error ? error.message : 'UnknownError',
        })
        if (!latestCall || latestCall.callId !== current.callId || latestCall.status === 'ended')
          return
        socket.emit('call:end', { callId: current.callId })
        const message =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Microphone permission was denied'
            : error instanceof DOMException && error.name === 'NotFoundError'
              ? 'No microphone is available'
              : error instanceof DOMException && error.name === 'NotReadableError'
                ? 'Microphone is unavailable or in use by another app'
                : 'Microphone is unavailable'
        endLocal(message)
      }
    },
    [applySignal, endLocal],
  )

  const startCall = useCallback((chatId: string, peerName: string) => {
    if (callRef.current || pendingInvite.current) return
    pendingInvite.current = true
    setBusyMessage('')
    socket.emit('call:invite', { chatId }, (result) => {
      pendingInvite.current = false
      if ('error' in result) {
        setBusyMessage(result.error)
        return
      }
      const next: CallState = {
        callId: result.callId,
        chatId,
        peerId: '',
        peerName,
        role: 'caller',
        status: 'outgoing',
      }
      callRef.current = next
      setCall(next)
    })
  }, [])
  const acceptCall = useCallback(() => {
    const current = callRef.current
    if (!current || current.role !== 'callee' || current.status !== 'incoming') return
    void prepareMedia(current, false).then(() => {
      const latestCall = callRef.current
      if (!latestCall || latestCall.callId !== current.callId || latestCall.status === 'ended')
        return

      console.info('[call] sending acceptance', { callId: current.callId })
      socket.emit('call:accept', { callId: current.callId }, (result) => {
        if ('error' in result) {
          console.warn('[call] acceptance rejected', { callId: current.callId, error: result.error })
          endLocal(result.error)
        }
      })
    })
  }, [endLocal, prepareMedia])
  const declineCall = useCallback(() => {
    const current = callRef.current
    if (!current) return
    socket.emit('call:decline', { callId: current.callId })
    endLocal('Call declined')
  }, [endLocal])
  const endCall = useCallback(() => {
    const current = callRef.current
    if (current)
      socket.emit(current.status === 'outgoing' ? 'call:cancel' : 'call:end', {
        callId: current.callId,
      })
    endLocal('Call ended')
  }, [endLocal])

  useEffect(() => {
    const incoming = (data: {
      callId: string
      chatId: string
      fromUserId: string
      fromName: string
    }) => {
      if (callRef.current) {
        socket.emit('call:decline', { callId: data.callId })
        return
      }
      setBusyMessage('')
      const next: CallState = {
        callId: data.callId,
        chatId: data.chatId,
        peerId: data.fromUserId,
        peerName: data.fromName,
        role: 'callee',
        status: 'incoming',
      }
      callRef.current = next
      setCall(next)
    }
    const accepted = (data: { callId: string }) => {
      const current = callRef.current
      if (!current || current.callId !== data.callId || current.role !== 'caller') return
      void prepareMedia(current, true)
    }
    const declined = (data: { callId: string }) => {
      if (callRef.current?.callId === data.callId) endLocal('Call declined')
    }
    const ended = (data: { callId: string; reason: string }) => {
      if (callRef.current?.callId !== data.callId) return
      console.warn('[call] server ended call', { callId: data.callId, reason: data.reason })
      endLocal(
        data.reason === 'timeout'
          ? 'No answer'
          : data.reason === 'disconnected'
            ? 'The other person disconnected'
            : 'Call ended',
      )
    }
    const signal = (data: {
      callId: string
      description?: RTCSessionDescriptionInit
      candidate?: RTCIceCandidateInit
    }) => {
      if (callRef.current?.callId === data.callId) void applySignal(data)
    }
    const socketDisconnected = (reason: string) => {
      const current = callRef.current
      if (current && current.status !== 'ended')
        console.warn('[call] signaling socket disconnected', { callId: current.callId, reason })
    }
    const socketConnectError = (error: Error) => {
      const current = callRef.current
      if (current && current.status !== 'ended')
        console.warn('[call] signaling socket connection failed', {
          callId: current.callId,
          error: error.message,
        })
    }
    socket.on('call:incoming', incoming)
    socket.on('call:accepted', accepted)
    socket.on('call:declined', declined)
    socket.on('call:ended', ended)
    socket.on('call:signal', signal)
    socket.on('disconnect', socketDisconnected)
    socket.on('connect_error', socketConnectError)
    return () => {
      socket.off('call:incoming', incoming)
      socket.off('call:accepted', accepted)
      socket.off('call:declined', declined)
      socket.off('call:ended', ended)
      socket.off('call:signal', signal)
      socket.off('disconnect', socketDisconnected)
      socket.off('connect_error', socketConnectError)
    }
  }, [applySignal, endLocal, prepareMedia])

  // Keep call ownership separate from listener subscription cleanup. If the
  // listener effect ever needs to resubscribe, that must not end an active call.
  useEffect(() => () => {
    const current = callRef.current
    if (current && current.status !== 'ended') {
      console.info('[call] provider unmounted; ending call', { callId: current.callId })
      socket.emit(current.status === 'outgoing' ? 'call:cancel' : 'call:end', {
        callId: current.callId,
      })
    }
    releaseMedia()
  }, [releaseMedia])

  const toggleAudio = () => {
    const enabled = !audioEnabled
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
    setAudioEnabled(enabled)
  }
  const toggleVideo = () => {
    const enabled = !videoEnabled
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = enabled
    })
    setVideoEnabled(enabled)
  }
  return (
    <CallContext.Provider
      value={{
        call,
        localStream,
        remoteStream,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleAudio,
        toggleVideo,
        audioEnabled,
        videoEnabled,
        busyMessage,
      }}
    >
      {children}
    </CallContext.Provider>
  )
}

export function useVideoCall() {
  const value = useContext(CallContext)
  if (!value) throw new Error('useVideoCall must be used inside VideoCallProvider')
  return value
}

export function VideoCallOverlay() {
  const {
    call,
    localStream,
    remoteStream,
    acceptCall,
    declineCall,
    endCall,
    toggleAudio,
    toggleVideo,
    audioEnabled,
    videoEnabled,
  } = useVideoCall()
  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = localStream
  }, [localStream])
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream
  }, [remoteStream, call?.status])
  if (!call) return null
  return (
    <div className="call-backdrop" role="dialog" aria-modal="true" aria-label="Video call">
      <section className="call-panel">
        <header className="call-heading">
          <div>
            <strong>{call.peerName}</strong>
            <p>
              {call.message ??
                (call.status === 'incoming'
                  ? 'Incoming video call'
                  : call.status === 'outgoing'
                    ? 'Calling…'
                    : call.status === 'active'
                      ? 'Connected'
                      : call.status === 'ended'
                        ? 'Call finished'
                        : 'Connecting…')}
            </p>
          </div>
        </header>
        <div className="call-videos">
          {call.status === 'active' ? (
            remoteStream?.getVideoTracks().some((track) => track.readyState !== 'ended') ? (
              <video ref={remoteVideo} autoPlay playsInline className="remote-video" />
            ) : (
              <div className="remote-placeholder">
                Connected; waiting for the other person’s video…
              </div>
            )
          ) : (
            <div className="remote-placeholder">
              {call.status === 'incoming'
                ? 'Incoming call'
                : call.status === 'outgoing'
                  ? 'Waiting for answer'
                  : (call.message ?? 'Connecting video…')}
            </div>
          )}
          {localStream?.getVideoTracks().length ? (
            <video ref={localVideo} autoPlay muted playsInline className="local-video" />
          ) : localStream ? (
            <div className="local-video remote-placeholder">Microphone only</div>
          ) : null}
        </div>
        {call.status === 'incoming' ? (
          <div className="call-actions">
            <button className="call-decline" onClick={declineCall}>
              Decline
            </button>
            <button className="call-accept" onClick={acceptCall}>
              Accept
            </button>
          </div>
        ) : (
          call.status !== 'ended' && (
            <div className="call-actions">
              <button onClick={toggleAudio}>{audioEnabled ? 'Mute' : 'Unmute'}</button>
              {localStream?.getVideoTracks().length ? (
                <button onClick={toggleVideo}>{videoEnabled ? 'Camera off' : 'Camera on'}</button>
              ) : null}
              <button className="call-decline" onClick={endCall}>
                {call.status === 'outgoing' ? 'Cancel call' : 'End call'}
              </button>
            </div>
          )
        )}
      </section>
    </div>
  )
}
