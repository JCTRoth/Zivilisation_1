import React from 'react';
import { Modal, Button } from 'react-bootstrap';
import { getWonder } from '@/data/WonderData';
import '@/styles/wonders.css';

/** The 'conflict' variant of the wonder dialog queue entry. */
interface WonderConflictNotice {
  kind: 'conflict';
  wonderId: string;
  cityId: string;
  cityName: string;
  ownerCityId: string;
  ownerCityName: string;
  ownerCivId: number;
  ownerCivName: string;
  /** Completed group member that won, when this was a group loss. */
  blockedByWonderId?: string;
  blockedByWonderName?: string;
}

interface WonderConflictModalProps {
  show: boolean;
  notice: WonderConflictNotice | null;
  /** Center the map on the idle city and open its city screen. */
  onGoToCity: (cityId: string) => void;
  /** Plain close. */
  onClose: () => void;
}

/**
 * Production conflict popup (spec D): a human city finished a wonder that
 * somebody else completed first. Civ 1 wastes the shields and leaves the city
 * idle — this modal says exactly that and offers "Go to City" / "Close".
 */
const WonderConflictModal: React.FC<WonderConflictModalProps> = ({ show, notice, onGoToCity, onClose }) => {
  if (!notice) return null;
  const wonder = getWonder(notice.wonderId);
  // Group loss (e.g. Tiangong while the ISS exists): name the wonder that
  // actually won instead of claiming the attempted one was completed.
  const won = notice.blockedByWonderId && notice.blockedByWonderId !== notice.wonderId
    ? (getWonder(notice.blockedByWonderId) ?? wonder)
    : wonder;

  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      backdrop="static"
      keyboard={false}
      dialogClassName="wonder-conflict-modal"
      aria-labelledby="wonder-conflict-title"
    >
      <Modal.Header>
        <Modal.Title id="wonder-conflict-title" className="wonder-conflict-title h5">
          ⚠ {won?.icon ?? '🏗️'} {won?.name ?? 'Wonder'} — already completed
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="wonder-conflict-body">
        <div className="wonder-conflict-message">
          This Wonder has already been completed by another civilization / city.
          Production has been cancelled and the city is now idle.
        </div>
        <div className="wonder-conflict-detail">
          First completion wins:{' '}
          <strong>
            {notice.ownerCivName} — {notice.ownerCityName}
          </strong>{' '}
          already finished {won?.name ?? 'the wonder'}. The shields invested in{' '}
          <strong>{notice.cityName}</strong> are lost (original Civ 1 rule).
        </div>
        <div className="wonder-conflict-actions">
          <Button variant="outline-light" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => onGoToCity(notice.cityId)}>
            <i className="bi bi-geo-alt me-1"></i> Go to City
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default WonderConflictModal;
