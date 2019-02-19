import { logger } from '../../lib/index';
import Recipients from '../../lib/recipients';

export default function respond(event, cb) {
  logger().info('= getTotalRecipients.action', JSON.stringify(event));
  return Recipients.totalRecipients(event.userId)
    .then(count => cb(null, { totalRecipients: count }))
    .catch((err) => {
      logger().error(err);
      return cb(err);
    });
}
