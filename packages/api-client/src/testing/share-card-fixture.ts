import fixture from './share-card-fixture.json'
import { preparedShareCardSchema } from '../contracts/http/share-cards'
export const preparedShareCardFixture = preparedShareCardSchema.parse(fixture)
