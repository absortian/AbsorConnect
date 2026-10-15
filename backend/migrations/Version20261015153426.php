<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261015153426 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Equipos de cada cuenta y solicitudes de sesión de control remoto (add-remote-desktop)';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE device (id UUID NOT NULL, key_hash VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL, platform VARCHAR(10) NOT NULL, app_version VARCHAR(32) NOT NULL, remote_state VARCHAR(20) NOT NULL, features JSONB NOT NULL, last_seen_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, user_id UUID NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE INDEX idx_device_user ON device (user_id)');
        $this->addSql('CREATE INDEX idx_device_last_seen ON device (last_seen_at)');
        $this->addSql('CREATE TABLE remote_request (id UUID NOT NULL, controller_name VARCHAR(100) NOT NULL, offer TEXT NOT NULL, answer TEXT DEFAULT NULL, rejection VARCHAR(30) DEFAULT NULL, retry_after INT DEFAULT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, user_id UUID NOT NULL, device_id UUID NOT NULL, controller_session_id UUID NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE INDEX idx_remote_request_device ON remote_request (device_id, expires_at)');
        $this->addSql('CREATE INDEX idx_remote_request_expires ON remote_request (expires_at)');
        $this->addSql('CREATE INDEX IDX_7F1C38F8A76ED395 ON remote_request (user_id)');
        $this->addSql('CREATE INDEX IDX_7F1C38F894A4C7D4 ON remote_request (device_id)');
        $this->addSql('CREATE INDEX IDX_7F1C38F82307FDFE ON remote_request (controller_session_id)');
        $this->addSql('ALTER TABLE device ADD CONSTRAINT FK_92FB68EA76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE remote_request ADD CONSTRAINT FK_7F1C38F8A76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE remote_request ADD CONSTRAINT FK_7F1C38F894A4C7D4 FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE remote_request ADD CONSTRAINT FK_7F1C38F82307FDFE FOREIGN KEY (controller_session_id) REFERENCES user_session (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE device DROP CONSTRAINT FK_92FB68EA76ED395');
        $this->addSql('ALTER TABLE remote_request DROP CONSTRAINT FK_7F1C38F8A76ED395');
        $this->addSql('ALTER TABLE remote_request DROP CONSTRAINT FK_7F1C38F894A4C7D4');
        $this->addSql('ALTER TABLE remote_request DROP CONSTRAINT FK_7F1C38F82307FDFE');
        $this->addSql('DROP TABLE device');
        $this->addSql('DROP TABLE remote_request');
    }
}
