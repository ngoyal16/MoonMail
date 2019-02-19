import { logger } from '../../lib/index';
import Recipients from '../../lib/recipients';

export default function respond(event, cb) {
  logger().info('= enhanceRecipientMetadata.action', JSON.stringify(event));
  Recipients.processOpenClickEventsStream(event.Records)
    .then(response => cb(null, response))
    .catch((error) => {
      logger().error(error);
      cb(error);
    });
}
