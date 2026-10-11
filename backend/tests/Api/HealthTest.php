<?php

namespace App\Tests\Api;

use App\Controller\HealthController;
use App\Tests\ApiTestCase;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception\ConnectionException;

final class HealthTest extends ApiTestCase
{
    public function testHealthyWithoutToken(): void
    {
        self::assertSame(['status' => 'ok'], $this->getJson('/api/health'));
        self::assertResponseIsSuccessful();
    }

    public function testUnavailableDatabaseIs503AndReconnects(): void
    {
        $connection = $this->createMock(Connection::class);
        $connection->method('executeQuery')->willThrowException($this->createStub(ConnectionException::class));
        $connection->expects(self::once())->method('close');

        $response = (new HealthController($connection))();

        self::assertSame(503, $response->getStatusCode());
        self::assertSame('{"error":{"code":"database_unavailable"}}', $response->getContent());
    }
}
