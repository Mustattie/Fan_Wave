import React from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CLIP_PREVIEW_BUFFER_OPTIONS } from '@/lib/videoBuffer';

export interface ChatPreviewMedia {
  url: string;
  type: 'video' | 'image';
}

export default function ChatMediaPreview({ media, onClose }: {
  media: ChatPreviewMedia | null;
  onClose: () => void;
}) {
  // Wire media_type is authoritative: signed/query URLs need not end in .mp4.
  // Closing the modal or showing an image also releases the video source.
  const player = useVideoPlayer(media?.type === 'video' ? media.url : null, (p) => {
    p.bufferOptions = CLIP_PREVIEW_BUFFER_OPTIONS;
    p.loop = false;
    p.muted = false;
    p.play();
  });
  return <Modal visible={!!media} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
      {media?.type === 'video' ? (
        <VideoView player={player} style={styles.media} nativeControls contentFit="contain" />
      ) : media ? (
        <Image source={{ uri: media.url }} style={styles.media} resizeMode="contain" />
      ) : null}
    </TouchableOpacity>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '80%' },
});
