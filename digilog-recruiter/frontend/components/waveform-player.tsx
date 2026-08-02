"use client"

import { useState, useEffect, useRef } from "react"
import { Play, Pause, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

interface WaveformPlayerProps {
  audioUrl?: string
}

export function WaveformPlayer({ audioUrl }: WaveformPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.75)
  const [isMuted, setIsMuted] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animationRef = useRef<number>()

  useEffect(() => {
    // Create audio element
    const audio = new Audio(audioUrl || "")
    audioRef.current = audio

    // Set up event listeners
    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration)
    })

    audio.addEventListener("ended", () => {
      setIsPlaying(false)
    })

    // Clean up
    return () => {
      audio.pause()
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [audioUrl])

  // Update time display during playback
  const updateTimeDisplay = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
      animationRef.current = requestAnimationFrame(updateTimeDisplay)
    }
  }

  // Toggle play/pause
  const togglePlayPause = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
      cancelAnimationFrame(animationRef.current!)
    } else {
      audioRef.current.play()
      animationRef.current = requestAnimationFrame(updateTimeDisplay)
    }

    setIsPlaying(!isPlaying)
  }

  // Handle seeking
  const handleSeek = (value: number[]) => {
    if (!audioRef.current) return

    const newTime = value[0]
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  // Handle volume change
  const handleVolumeChange = (value: number[]) => {
    if (!audioRef.current) return

    const newVolume = value[0]
    audioRef.current.volume = newVolume
    setVolume(newVolume)

    if (newVolume === 0) {
      setIsMuted(true)
    } else if (isMuted) {
      setIsMuted(false)
    }
  }

  // Toggle mute
  const toggleMute = () => {
    if (!audioRef.current) return

    if (isMuted) {
      audioRef.current.volume = volume
      setIsMuted(false)
    } else {
      audioRef.current.volume = 0
      setIsMuted(true)
    }
  }

  // Format time (seconds -> mm:ss)
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  // Generate waveform bars
  const generateWaveform = () => {
    // In a real app, this would use actual audio data
    // For demo, we'll generate random heights
    return Array.from({ length: 100 }).map((_, i) => {
      const height = Math.random() * 100
      const isActive = (i / 100) * duration <= currentTime

      return (
        <div
          key={i}
          className={`w-1 ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`}
          style={{ height: `${height}%` }}
        />
      )
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={togglePlayPause}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <span className="text-sm font-medium">
            {formatTime(currentTime)} / {formatTime(duration || 0)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume]}
            min={0}
            max={1}
            step={0.01}
            className="w-20"
            onValueChange={handleVolumeChange}
          />
        </div>
      </div>

      <div className="relative h-24 rounded-md bg-muted p-2">
        {/* Waveform visualization */}
        <div className="flex h-full items-end justify-between gap-0.5">{generateWaveform()}</div>

        {/* Seek bar */}
        <div className="absolute bottom-0 left-0 right-0 px-2">
          <Slider
            value={[currentTime]}
            min={0}
            max={duration || 100}
            step={0.1}
            className="mt-2"
            onValueChange={handleSeek}
          />
        </div>
      </div>

      {/* Sentiment visualization would go here in a real implementation */}
    </div>
  )
}
