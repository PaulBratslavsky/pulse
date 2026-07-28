import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  // Octolens integration — local plugin (earned: it ships admin UI — sync page + widget)
  octolens: { enabled: true, resolve: './src/plugins/octolens' },

  'users-permissions': {
    config: {
      // DECISION 2026-07-28: long-lived JWTs matching the 7-day auth cookie.
      // 'refresh' mode issues 10-MINUTE access tokens (docs default:
      // sessions.accessTokenLifespan = 600) and the Next app has no
      // refresh-token loop yet — users were signed out every ~10 minutes.
      // Revisit refresh mode when the frontend implements token rotation
      // (parked item in 06-build-spec).
      jwtManagement: 'legacy-support',
      jwt: { expiresIn: '7d' },
      // Dev/test only: the default auth rate limit (small max per interval) trips
      // repeated e2e runs ("Too many requests"). Production keeps the default.
      ...(process.env.NODE_ENV !== 'production'
        ? { ratelimit: { interval: 60000, max: 100 } }
        : {}),
    },
  },
  upload: {
    config: {
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes: deniedExecutableTypes,
      },
    },
  },
});

export default config;
