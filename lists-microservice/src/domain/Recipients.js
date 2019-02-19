import Promise from 'bluebird';
import _ from 'lodash';
import request from 'request-promise';
import RecipientModel from './RecipientModel';
import RecipientESModel from './RecipientESModel';

function importFromEvents(recipientImportedEvents) {
  const recipients = recipientImportedEvents
    .map(event => Object.assign({}, event.payload.recipient, { status: RecipientModel.statuses.subscribed, subscriptionOrigin: RecipientModel.subscriptionOrigins.listImport, isConfirmed: true }));

  // TODO: Move me to Recipients
  const recipientsToSave = deduplicateRecipientsByListId(recipients);
  return RecipientModel.batchCreate(recipientsToSave)
    .then((data) => {
      if (data.UnprocessedItems) {
        if (Object.keys(data.UnprocessedItems).length > 0) return Promise.reject(new Error('UnprocessedItems'));
      }
      return data;
    });
}

function createBatchFromEvents(recipientCreatedEvents) {
  const recipients = recipientCreatedEvents
    .map(event => event.payload.recipient);

  // TODO: Move me to Recipients
  const recipientsToSave = deduplicateRecipientsByListId(recipients);
  return RecipientModel.batchCreate(recipientsToSave)
    .then((data) => {
      if (data.UnprocessedItems) {
        if (Object.keys(data.UnprocessedItems).length > 0) return Promise.reject(new Error('UnprocessedItems'));
      }
      return data;
    });
}

function updateBatchFromEvents(recipientUpdatedEvents) {
  return Promise.map(recipientUpdatedEvents, recipientUpdatedEvent => RecipientModel.update(recipientUpdatedEvent.payload.data, recipientUpdatedEvent.payload.listId, recipientUpdatedEvent.payload.id), { concurrency: 2 });
}

function fixMetadataAttrs(m) {
  if (!m) return {};
  return Object.keys(m)
    .filter(r => r.match(/^[A-Za-z_]+[A-Za-z0-9_]*$/))
    .reduce((acum, key) => {
      acum[key.toString()] = m[key].toString();
      return acum;
    }, {});
}

function deduplicateRecipientsByListId(recipients) {
  const recipientsByListId = _.groupBy(recipients, 'listId');
  const uniqueRecipientsByListId = _.mapValues(recipientsByListId, rcpts => _.uniqBy(rcpts, 'email'));
  return _.flatten(Object.values(uniqueRecipientsByListId));
}

function cleanseRecipientAttributes(recipient) {
  const newRecipient = {
    listId: recipient.listId,
    userId: recipient.userId,
    id: (recipient.id || '').toString(),
    email: (recipient.email || '').trim(),
    subscriptionOrigin: recipient.subscriptionOrigin || 'listImport',
    isConfirmed: recipient.isConfirmed,
    status: recipient.status,
    riskScore: recipient.riskScore,
    metadata: fixMetadataAttrs(recipient.metadata),
    systemMetadata: recipient.systemMetadata,
    unsubscribedAt: recipient.unsubscribedAt,
    subscribedAt: recipient.subscribedAt,
    unsubscribedCampaignId: recipient.unsubscribedCampaignId,
    bouncedAt: recipient.bouncedAt,
    complainedAt: recipient.complainedAt,
    createdAt: recipient.createdAt,
    updatedAt: recipient.updatedAt
  };

  if (!newRecipient.email || !newRecipient.listId || !newRecipient.userId || !newRecipient.id) {
    return false;
  }
  return newRecipient;
}

function discoverFieldsFromRequestMetadata(requestMetadata) {
  const cfIpAddress = (requestMetadata['X-Forwarded-For'] || ',').split(',').shift().trim();
  const acceptLanguage = (requestMetadata['Accept-Language'] || ',').split(',').shift().trim();
  const language = (acceptLanguage || '_').split(/\-|_/).shift().trim();
  const updateMetadata = omitEmpty({
    ip: cfIpAddress,
    countryCode: requestMetadata['CloudFront-Viewer-Country'],
    acceptLanguageHeader: requestMetadata['Accept-Language'],
    acceptLanguage,
    language,
    detectedDevice: findDetectedDevice(requestMetadata),
    userAgent: requestMetadata['User-Agent']
  });
  
  return request(`https://freegeoip.net/json/${cfIpAddress}`)
    .then(result => JSON.parse(result))
    .then(geoLocationData => omitEmpty(Object.assign({}, updatedMetadata, {
      countryName: geoLocationData.country_name,
      regionCode: geoLocationData.region_code,
      regionName: geoLocationData.region_name,
      city: geoLocationData.city,
      zipCode: geoLocationData.zip_code,
      timeZone: geoLocationData.time_zone,
      location: {
        lat: geoLocationData.latitude,
        lon: geoLocationData.longitude
      },
      metroCode: geoLocationData.metro_code
    })));
}

function storeRecipientSystemMetadata(recipient, systemMetadata) {
  if (systemMetadata.userAgent.match(/GoogleImageProxy/)) return Promise.resolve();
  return RecipientModel.update({ systemMetadata }, recipient.listId, recipient.id);
}

function processOpenClickEvent(record) {
  if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
    const item = record.newImage;
    if (!item.metadata || !item.listId || !item.recipientId) return Promise.resolve();
    
    const recipientId = item.recipientId;
    const listId = item.listId;
    // We are performing a get before the update before
    // somehow listId and recipientId sometimes point to non-existing recipients
    // on this way we can avoid errors instead of recovering from them on the update
    return RecipientModel.get(listId, recipientId)
      .then((recipient) => {
        if (!recipient.id) return Promise.resolve();
        return discoverFieldsFromRequestMetadata(item.metadata)
          .then((newMetadata) => storeRecipientSystemMetadata(recipient, newMetadata));
      });
  }
  return Promise.resolve();
}

export default {
  buildId: RecipientModel.buildId,
  create: RecipientModel.create,
  batchCreate: RecipientModel.batchCreate,
  update: RecipientModel.update,
  delete: RecipientModel.delete,
  find: RecipientESModel.find,
  createEs: RecipientESModel.create,
  updateEs: RecipientESModel.update,
  deleteEs: RecipientESModel.remove,
  searchByListAndConditions: RecipientESModel.searchByListAndConditions,
  searchSubscribedByListAndConditions: RecipientESModel.searchSubscribedByListAndConditions,
  search: RecipientESModel.search,
  createBatchFromEvents,
  importFromEvents,
  updateBatchFromEvents,
  cleanseRecipientAttributes,
  processOpenClickEvent
};
