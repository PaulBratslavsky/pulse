import type { Schema, Struct } from '@strapi/strapi';

export interface SharedOutcome extends Struct.ComponentSchema {
  collectionName: 'components_shared_outcomes';
  info: {
    description: 'How a response landed';
    displayName: 'Outcome';
  };
  attributes: {
    notes: Schema.Attribute.Text;
    recordedAt: Schema.Attribute.DateTime;
    result: Schema.Attribute.Enumeration<
      ['resolved', 'positive-turn', 'no-reaction', 'escalated']
    >;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'shared.outcome': SharedOutcome;
    }
  }
}
