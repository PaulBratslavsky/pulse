import { useEffect, useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { useFetchClient } from '@strapi/admin/strapi-admin';

/** Homepage widget: last-sync glance + one-click 24h sync. */
export const SyncWidget = () => {
  const { get, post } = useFetchClient();
  const [line, setLine] = useState('Loading…');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const { data } = await get('/octolens/status');
      const s = data.data;
      setLine(
        s.enabled
          ? `${s.totalMentions} mentions · last ${s.lastReceivedAt ? new Date(s.lastReceivedAt).toLocaleString() : '—'}`
          : 'OCTOLENS_API not configured'
      );
    } catch {
      setLine('status unavailable');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await post('/octolens/sync', { lookbackHours: 24 });
      setLine(`synced: ${data.data.created} new / ${data.data.seen} seen`);
    } catch {
      setLine('sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box padding={2}>
      <Flex direction="column" gap={2} alignItems="flex-start">
        <Typography variant="pi">{line}</Typography>
        <Button size="S" onClick={run} loading={busy}>
          Sync now
        </Button>
      </Flex>
    </Box>
  );
};

export default SyncWidget;
