export const config = {
  default: {
    /** newest uploads read per channel per run (playlistItems pages of 50) */
    youtubeUploadsLimit: 100,
  },
  validator(config: any) {
    const n = config?.youtubeUploadsLimit;
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
      throw new Error('brain.youtubeUploadsLimit must be a positive integer');
    }
  },
};
