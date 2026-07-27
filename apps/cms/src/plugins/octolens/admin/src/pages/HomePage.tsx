import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Typography,
  NumberInput,
  Alert,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
} from '@strapi/design-system';
import { useFetchClient } from '@strapi/admin/strapi-admin';

type Status = { enabled: boolean; totalMentions: number; lastReceivedAt: string | null };
type CreatedItem = { documentId: string; excerpt: string; platform: string; sentiment: string | null };
type SyncResult = {
  created: number;
  seen: number;
  skippedIrrelevant: number;
  pages: number;
  lookbackHours: number;
  createdItems?: CreatedItem[];
};

export const HomePage = () => {
  const { get, post } = useFetchClient();
  const [status, setStatus] = useState<Status | null>(null);
  const [lookbackHours, setLookbackHours] = useState<number>(24);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { data } = await get('/octolens/status');
      setStatus(data.data);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const runSync = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await post('/octolens/sync', { lookbackHours });
      setResult(data.data);
      setRanAt(new Date().toLocaleString());
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? e?.message ?? 'sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box padding={8}>
      <Typography variant="alpha" tag="h1">
        Octolens
      </Typography>
      <Typography variant="epsilon" textColor="neutral600" tag="p">
        Pull-sync is the primary ingestion path (cron runs every 5 minutes). Use Sync now for an
        immediate pull or a longer-lookback backfill.
      </Typography>

      <Box paddingTop={6} paddingBottom={6}>
        {status ? (
          <Flex gap={6}>
            <Typography>
              API key: <strong>{status.enabled ? 'configured' : 'missing (sync disabled)'}</strong>
            </Typography>
            <Typography>
              Mentions: <strong>{status.totalMentions}</strong>
            </Typography>
            <Typography>
              Last received:{' '}
              <strong>{status.lastReceivedAt ? new Date(status.lastReceivedAt).toLocaleString() : '—'}</strong>
            </Typography>
          </Flex>
        ) : (
          <Typography textColor="neutral600">Loading status…</Typography>
        )}
      </Box>

      <Flex gap={4} alignItems="flex-end">
        <Box width="220px">
          <NumberInput
            label="Lookback (hours)"
            name="lookbackHours"
            value={lookbackHours}
            onValueChange={(v: number) => setLookbackHours(v ?? 24)}
          />
        </Box>
        <Button onClick={runSync} loading={busy} disabled={busy || status?.enabled === false}>
          Sync now
        </Button>
      </Flex>

      {error && (
        <Box paddingTop={4}>
          <Alert closeLabel="Close" title="Sync failed" variant="danger" onClose={() => setError(null)}>
            {error}
          </Alert>
        </Box>
      )}

      {result && (
        <Box paddingTop={6}>
          <Typography variant="beta" tag="h2">
            Sync report
          </Typography>
          <Box paddingTop={2} paddingBottom={4}>
            <Typography textColor="neutral600">
              Ran {ranAt} · lookback {result.lookbackHours}h · <strong>{result.created} new</strong> ·{' '}
              {result.seen} seen · {result.skippedIrrelevant} irrelevant skipped · {result.pages} page(s)
            </Typography>
          </Box>

          {result.created === 0 ? (
            <Typography textColor="neutral600">
              No new mentions — everything in this window was already ingested (webhook, cron, or a
              previous sync).
            </Typography>
          ) : (
            <Table colCount={3} rowCount={(result.createdItems?.length ?? 0) + 1}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">Mention</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Platform</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Octolens sentiment</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {(result.createdItems ?? []).map((item) => (
                  <Tr key={item.documentId}>
                    <Td>
                      <Typography ellipsis style={{ maxWidth: '560px', display: 'block' }}>
                        {item.excerpt}
                      </Typography>
                    </Td>
                    <Td>
                      <Badge>{item.platform}</Badge>
                    </Td>
                    <Td>
                      <Typography>{item.sentiment ?? '—'}</Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Box>
      )}
    </Box>
  );
};

export default HomePage;
